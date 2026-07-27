import './node-shims'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { detectTestDate, parseBiomarkers } from '@/lib/parser'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  '/Users/emanuelenicolella/Public/GitHub/Htech/biomarker-hud/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'

const DIR = '/Users/emanuelenicolella/Public/GitHub/Htech/sample-reports'

// --- same line-reconstruction logic as src/lib/extract.ts ---
async function extractText(file: string): Promise<string> {
  const data = new Uint8Array(readFileSync(file))
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
  return text
}

const dumpRaw = process.argv.includes('--raw')
const onlyIdx = process.argv.find((a) => a.startsWith('--only='))

const files = readdirSync(DIR).filter((f) => f.endsWith('.pdf')).sort()
for (let fi = 0; fi < files.length; fi++) {
  if (onlyIdx && fi !== Number(onlyIdx.split('=')[1])) continue
  const f = files[fi]
  const text = await extractText(join(DIR, f))
  if (dumpRaw) {
    console.log(`\n########## RAW [${fi}] ${f.slice(0, 8)}… ##########`)
    console.log(text)
    continue
  }
  const rows = parseBiomarkers(text)
  const withRange = rows.filter((r) => r.refLow !== null || r.refHigh !== null)
  const flags = { high: 0, low: 0, normal: 0, unknown: 0 }
  for (const r of rows) flags[r.flag]++
  console.log(`\n[${fi}] ${f.slice(0, 12)}…  date=${detectTestDate(text)}  rows=${rows.length}  withRange=${withRange.length}  flags H${flags.high}/L${flags.low}/N${flags.normal}/?${flags.unknown}`)
  for (const r of rows) {
    const mark = r.refLow === null && r.refHigh === null ? ' << NO RANGE' : ''
    console.log(`   ${r.name.padEnd(26)} ${String(r.value).padStart(8)} ${r.unit.padEnd(10)} [${r.refLow ?? '—'}, ${r.refHigh ?? '—'}] ${r.flag}${mark}`)
  }
}
