export type Flag = 'low' | 'normal' | 'high' | 'unknown'

export type Category =
  | 'CBC'
  | 'Lipids'
  | 'Metabolic'
  | 'Liver'
  | 'Kidney'
  | 'Thyroid'
  | 'Vitamins'
  | 'Hormones'
  | 'Inflammation'
  | 'Glucose'
  | 'Other'

export interface BiomarkerReading {
  /** SQLite row id — present when loaded from the backend */
  id?: number
  name: string
  category: Category
  value: number
  unit: string
  refLow: number | null
  refHigh: number | null
  flag: Flag
}

export interface TestRecord {
  id: string
  /** ISO date string yyyy-mm-dd */
  date: string
  sources: string[]
  markers: BiomarkerReading[]
  demo?: boolean
  createdAt: string
}

export interface ParsedBiomarker extends BiomarkerReading {
  /** original line the row was parsed from */
  sourceLine: string
}

export interface ExtractionResult {
  fileName: string
  ok: boolean
  error?: string
  date: string | null
  rows: ParsedBiomarker[]
  rawText: string
  method: 'pdf-text' | 'ocr' | 'pdf-ocr' | 'ai' | 'none'
}
