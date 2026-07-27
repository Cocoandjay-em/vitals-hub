import './node-shims'
import { readFileSync } from 'node:fs'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

// run text extraction on the main thread in node tests
pdfjsLib.GlobalWorkerOptions.workerSrc =
  '/Users/emanuelenicolella/Public/GitHub/Htech/biomarker-hud/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'
import { detectTestDate, parseBiomarkers } from '@/lib/parser'

const data = new Uint8Array(readFileSync('scripts/sample-lab.pdf'))
const pdf = await pdfjsLib.getDocument({ data }).promise
let text = ''
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i)
  const content = await page.getTextContent()
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
  text += lines.join('\n') + '\n'
}
console.log('--- extracted text ---')
console.log(text)
console.log('--- parsed ---')
for (const r of parseBiomarkers(text)) {
  console.log(`${r.name.padEnd(22)} ${String(r.value).padStart(7)} ${r.unit.padEnd(8)} [${r.refLow ?? '—'}, ${r.refHigh ?? '—'}] ${r.flag} (${r.category})`)
}
console.log('date:', detectTestDate(text))
