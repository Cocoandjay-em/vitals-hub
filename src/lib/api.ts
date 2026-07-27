import type { BiomarkerReading, Category, Flag, TestRecord } from '@/types/biomarker'

/**
 * Typed client for the Vitals HUD backend.
 * In dev, Vite proxies /api → localhost:3101; in production the same
 * Express process serves both the API and the built frontend.
 */

/* ------------------------------ wire shapes ------------------------------ */

interface ApiBiomarker {
  id: number
  testId: string
  name: string
  category: string
  value: number
  unit: string
  refLow: number | null
  refHigh: number | null
  flag: string
}

interface ApiTest {
  id: string
  date: string
  sources: string[]
  demo: boolean
  createdAt: string
}

export interface AiConfigPublic {
  baseUrl: string
  model: string
  hasKey: boolean
}

export interface AiFileResult {
  fileName: string
  date: string | null
  source: string | null
  biomarkers: Array<{
    name: string
    value: number
    unit: string | null
    refLow: number | null
    refHigh: number | null
    flag: string
    category: string
  }>
  error?: string
}

export class ApiError extends Error {
  code?: string
  status: number
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError('Cannot reach the backend server. Is it running? (npm run dev)', 0, 'OFFLINE')
  }
  if (!res.ok) {
    let message = `Server error ${res.status}`
    let code: string | undefined
    try {
      const body = (await res.json()) as { error?: string; code?: string }
      if (body.error) message = body.error
      code = body.code
    } catch {
      /* keep default message */
    }
    throw new ApiError(message, res.status, code)
  }
  return (await res.json()) as T
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/* -------------------------------- history -------------------------------- */

/** Assemble TestRecord[] from the flat {tests, biomarkers} payload. */
export async function getHistory(): Promise<TestRecord[]> {
  const data = await request<{ tests: ApiTest[]; biomarkers: ApiBiomarker[] }>('/api/history')
  const byTest = new Map<string, BiomarkerReading[]>()
  for (const b of data.biomarkers) {
    const reading: BiomarkerReading = {
      id: b.id,
      name: b.name,
      category: b.category as Category,
      value: b.value,
      unit: b.unit,
      refLow: b.refLow,
      refHigh: b.refHigh,
      flag: b.flag as Flag,
    }
    const list = byTest.get(b.testId) ?? []
    list.push(reading)
    byTest.set(b.testId, list)
  }
  return data.tests.map((t) => ({
    id: t.id,
    date: t.date,
    sources: t.sources,
    markers: byTest.get(t.id) ?? [],
    demo: t.demo,
    createdAt: t.createdAt,
  }))
}

export interface SaveTestInput {
  date: string
  source?: string
  fileNames?: string[]
  demo?: boolean
  biomarkers: BiomarkerReading[]
}

export async function saveTest(input: SaveTestInput): Promise<void> {
  await request('/api/tests', jsonInit('POST', input))
}

export async function deleteMarker(id: number): Promise<void> {
  await request(`/api/markers/${id}`, { method: 'DELETE' })
}

export async function deleteTest(id: string): Promise<void> {
  await request(`/api/tests/${id}`, { method: 'DELETE' })
}

export async function clearHistory(): Promise<void> {
  await request('/api/history', { method: 'DELETE' })
}

/* -------------------------------- settings ------------------------------- */

export interface Profile {
  sex: 'male' | 'female'
}

export async function getProfile(): Promise<Profile> {
  return request<Profile>('/api/profile')
}

export async function putProfile(input: { sex: 'male' | 'female' }): Promise<Profile> {
  return request<Profile>('/api/profile', jsonInit('PUT', input))
}

export async function getConfig(): Promise<AiConfigPublic> {
  return request<AiConfigPublic>('/api/config')
}

export async function putConfig(input: {
  baseUrl?: string
  model?: string
  apiKey?: string
}): Promise<AiConfigPublic> {
  return request<AiConfigPublic>('/api/config', jsonInit('PUT', input))
}

export async function testConfig(): Promise<{ ok: boolean; detail: string }> {
  // the endpoint returns 502 on failure — read the body either way
  let res: Response
  try {
    res = await fetch('/api/config/test')
  } catch {
    return { ok: false, detail: 'Cannot reach the backend server.' }
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string }
  return { ok: !!body.ok, detail: body.detail ?? `HTTP ${res.status}` }
}

/* ------------------------------- extraction ------------------------------ */

export interface PageImage {
  name: string
  imageBase64: string
  mime: string
}

export async function extractAI(pages: PageImage[]): Promise<AiFileResult[]> {
  const data = await request<{ results: AiFileResult[] }>(
    '/api/extract',
    jsonInit('POST', { pages }),
  )
  return data.results
}

/* ------------------------------ explanations ----------------------------- */

export interface ExplainInput {
  region: string
  markers: Array<{
    name: string
    value: number
    unit: string
    refLow: number | null
    refHigh: number | null
    flag: string
  }>
  date?: string
}

export async function explain(input: ExplainInput): Promise<string> {
  const data = await request<{ explanation: string }>('/api/explain', jsonInit('POST', input))
  return data.explanation
}

export interface AnalysisInput {
  date?: string
  markers: Array<{
    name: string
    value: number
    unit: string
    refLow: number | null
    refHigh: number | null
    flag: string
    category: string
  }>
}

export async function analyzePanel(input: AnalysisInput): Promise<string> {
  const data = await request<{ analysis: string }>('/api/analysis', jsonInit('POST', input))
  return data.analysis
}

export interface MarkerExplainInput {
  name: string
  value: number
  unit: string
  refLow: number | null
  refHigh: number | null
  flag: string
  category?: string
}

export async function explainMarker(input: MarkerExplainInput): Promise<string> {
  const data = await request<{ explanation: string }>(
    '/api/explain-marker',
    jsonInit('POST', input),
  )
  return data.explanation
}

/* ------------------------------ Apple Health ----------------------------- */

export interface AppleHealthRecord {
  type: string
  date: string
  value: number
  unit: string
}

export async function importAppleHealth(
  records: AppleHealthRecord[],
): Promise<{ imported: number; days: number; skipped: number }> {
  return request('/api/import/apple-health', jsonInit('POST', { records }))
}
