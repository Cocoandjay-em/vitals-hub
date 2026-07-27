import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { createWorker } from 'tesseract.js'
import { detectTestDate, parseBiomarkers, todayISO } from '@/lib/parser'
import { ApiError, extractAI, getConfig, type AiFileResult, type PageImage } from '@/lib/api'
import type { Category, ExtractionResult, Flag } from '@/types/biomarker'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export type ProgressFn = (status: string) => void

async function extractPdfText(file: File, onProgress: ProgressFn): Promise<{ text: string; scannedPageImages: Blob[] }> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  let text = ''
  const scannedPageImages: Blob[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(`Reading PDF page ${i}/${pdf.numPages}…`)
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // reconstruct visual lines: group text items by their Y coordinate
    interface Item { x: number; y: number; str: string }
    const items: Item[] = []
    for (const raw of content.items) {
      if (!('str' in raw)) continue
      const str = raw.str.trim()
      if (!str) continue
      items.push({ x: raw.transform[4] ?? 0, y: raw.transform[5] ?? 0, str })
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: string[] = []
    let cur: Item[] = []
    let curY: number | null = null
    for (const it of items) {
      if (curY === null || Math.abs(it.y - curY) > 2.5) {
        if (cur.length > 0) lines.push(cur.map((c) => c.str).join(' '))
        cur = [it]
        curY = it.y
      } else {
        cur.push(it)
      }
    }
    if (cur.length > 0) lines.push(cur.map((c) => c.str).join(' '))
    const pageText = lines.join('\n').trim()
    if (pageText.length > 20) {
      text += pageText + '\n'
    } else {
      // scanned page: render to canvas for OCR
      onProgress(`Page ${i} has no text layer — rasterising for OCR…`)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport, canvas }).promise
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (blob) scannedPageImages.push(blob)
      }
    }
  }
  return { text, scannedPageImages }
}

async function ocrImage(image: Blob, onProgress: ProgressFn, label: string): Promise<string> {
  const worker = await createWorker('eng', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(`OCR ${label}: ${Math.round(m.progress * 100)}%`)
      } else {
        onProgress(`OCR ${label}: ${m.status}`)
      }
    },
  })
  try {
    const result = await worker.recognize(image)
    return result.data.text
  } finally {
    await worker.terminate()
  }
}

export async function extractFromFile(file: File, onProgress: ProgressFn): Promise<ExtractionResult> {
  // Prefer AI vision extraction when an API key is configured; fall back to
  // the offline heuristic pipeline when the backend/key is unavailable.
  let aiAvailable = false
  try {
    aiAvailable = (await getConfig()).hasKey
  } catch {
    aiAvailable = false
  }
  if (aiAvailable) {
    try {
      return await extractWithVision(file, onProgress)
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'NO_API_KEY' || err.code === 'OFFLINE')) {
        // key removed mid-flight or backend down → offline pipeline below
      } else {
        return {
          fileName: file.name,
          ok: false,
          error: `AI extraction failed: ${err instanceof Error ? err.message : String(err)}`,
          date: null,
          rows: [],
          rawText: '',
          method: 'ai',
        }
      }
    }
  }
  return extractOffline(file, onProgress)
}

/* ---------------------------- AI vision path ---------------------------- */

const AI_MAX_PAGES = 10

async function renderPageToJpeg(page: pdfjsLib.PDFPageProxy, scale: number): Promise<string> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? ''
}

/** Render a file's pages to JPEG for a vision call (shared with report intake). */
export async function rasteriseForAI(file: File, onProgress: ProgressFn): Promise<PageImage[]> {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const isPdf = file.type === 'application/pdf' || ext === 'pdf'
  if (isPdf) {
    const data = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data }).promise
    const pages: PageImage[] = []
    const count = Math.min(pdf.numPages, AI_MAX_PAGES)
    for (let i = 1; i <= count; i++) {
      onProgress(`AI: rasterising page ${i}/${count}…`)
      const page = await pdf.getPage(i)
      pages.push({ name: file.name, imageBase64: await renderPageToJpeg(page, 1.75), mime: 'image/jpeg' })
    }
    return pages
  }
  onProgress('AI: reading image…')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the image file'))
    reader.readAsDataURL(file)
  })
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/jpeg'
  return [{ name: file.name, imageBase64: dataUrl.split(',')[1] ?? '', mime }]
}

const VALID_CATEGORIES = new Set([
  'CBC', 'Lipids', 'Metabolic', 'Liver', 'Kidney', 'Thyroid',
  'Vitamins', 'Minerals', 'Hormones', 'Inflammation', 'Glucose', 'Coagulation', 'Other',
])
const VALID_FLAGS = new Set(['low', 'normal', 'high', 'unknown'])

function aiResultToExtraction(fileName: string, r: AiFileResult): ExtractionResult {
  const rows = r.biomarkers.map((b) => ({
    name: b.name,
    category: (VALID_CATEGORIES.has(b.category) ? b.category : 'Other') as Category,
    value: b.value,
    unit: b.unit ?? '',
    refLow: b.refLow,
    refHigh: b.refHigh,
    flag: (VALID_FLAGS.has(b.flag) ? b.flag : 'unknown') as Flag,
    sourceLine: 'AI vision extraction',
  }))
  return {
    fileName,
    ok: rows.length > 0 && !r.error,
    error: r.error ?? (rows.length === 0 ? 'The model found no biomarker rows in this file.' : undefined),
    date: r.date ?? todayISO(),
    rows,
    rawText: rows
      .map((b) => `${b.name}: ${b.value} ${b.unit}${b.refLow != null || b.refHigh != null ? ` (${b.refLow ?? '–'} – ${b.refHigh ?? '–'})` : ''} [${b.flag}]`)
      .join('\n'),
    method: 'ai',
  }
}

async function extractWithVision(file: File, onProgress: ProgressFn): Promise<ExtractionResult> {
  const pages = await rasteriseForAI(file, onProgress)
  onProgress(`AI: analysing ${pages.length} page${pages.length > 1 ? 's' : ''}…`)
  const [result] = await extractAI(pages)
  return aiResultToExtraction(file.name, result ?? { fileName: file.name, date: null, source: null, biomarkers: [], error: 'Empty response from server.' })
}

/* ------------------------ offline heuristic path ------------------------ */

async function extractOffline(file: File, onProgress: ProgressFn): Promise<ExtractionResult> {
  const base: ExtractionResult = {
    fileName: file.name,
    ok: false,
    date: null,
    rows: [],
    rawText: '',
    method: 'none',
  }
  try {
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    const isPdf = file.type === 'application/pdf' || ext === 'pdf'
    const isImage = /^image\//.test(file.type) || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'].includes(ext)

    let text = ''
    let method: ExtractionResult['method'] = 'none'

    if (isPdf) {
      const { text: pdfText, scannedPageImages } = await extractPdfText(file, onProgress)
      text = pdfText
      method = 'pdf-text'
      if (scannedPageImages.length > 0) {
        let ocrText = ''
        for (let i = 0; i < scannedPageImages.length; i++) {
          ocrText += (await ocrImage(scannedPageImages[i], onProgress, `page ${i + 1}`)) + '\n'
        }
        text += ocrText
        method = pdfText.trim().length > 0 ? 'pdf-text' : 'pdf-ocr'
        if (ocrText.trim().length > 0 && pdfText.trim().length === 0) method = 'pdf-ocr'
      }
    } else if (isImage) {
      onProgress('Loading OCR engine…')
      text = await ocrImage(file, onProgress, file.name)
      method = 'ocr'
    } else {
      return { ...base, error: `Unsupported file type "${file.type || ext}". Use PDF, JPG or PNG.` }
    }

    const rows = parseBiomarkers(text)
    const date = detectTestDate(text) ?? todayISO()
    return {
      ...base,
      ok: rows.length > 0,
      error: rows.length === 0 ? 'No biomarker rows could be parsed from the extracted text.' : undefined,
      date,
      rows,
      rawText: text.trim(),
      method,
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}
