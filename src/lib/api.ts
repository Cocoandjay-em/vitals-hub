import type { BiomarkerReading, Category, Flag, TestRecord } from '@/types/biomarker'
import type { ClinicalReport, ReportAnalysis } from '@/types/report'

/**
 * Typed client for the Vitals Hub backend.
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

/** Fired whenever any API call is rejected for a missing/expired session. */
export const UNAUTHENTICATED_EVENT = 'vitals-hub:unauthenticated'

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
    // an expired or revoked session must drop the whole app back to the login
    // screen, wherever the call was made from
    if (res.status === 401 && code === 'UNAUTHENTICATED') {
      window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT))
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

/* ----------------------------- authentication ---------------------------- */

export interface AuthStatus {
  /** false on a fresh install — the UI shows the create-account screen */
  configured: boolean
  authenticated: boolean
  username: string | null
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>('/api/auth/status')
}

export async function setupAccount(
  username: string,
  password: string,
  profile?: Partial<Profile>,
): Promise<{ username: string }> {
  return request<{ username: string }>(
    '/api/auth/setup',
    jsonInit('POST', { username, password, ...profile }),
  )
}

export async function login(username: string, password: string): Promise<{ username: string }> {
  return request<{ username: string }>('/api/auth/login', jsonInit('POST', { username, password }))
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request('/api/auth/password', jsonInit('POST', { currentPassword, newPassword }))
}

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
  firstName: string
  lastName: string
  /** ISO yyyy-mm-dd, empty when not set */
  birthDate: string
  /** picks which Visible Human body the 3D scan renders */
  sex: 'male' | 'female'
}

export async function getProfile(): Promise<Profile> {
  return request<Profile>('/api/profile')
}

/** Send only the fields being changed. */
export async function putProfile(input: Partial<Profile>): Promise<Profile> {
  return request<Profile>('/api/profile', jsonInit('PUT', input))
}

/** Whole years between a birth date and today; null when unset or unparseable. */
export function ageFromBirthDate(birthDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null
  const born = new Date(`${birthDate}T00:00:00`)
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const monthDelta = now.getMonth() - born.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age -= 1
  return age >= 0 && age < 150 ? age : null
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

/* --------------------------- clinical reports ---------------------------- */

export async function getReports(): Promise<ClinicalReport[]> {
  const data = await request<{ reports: ClinicalReport[] }>('/api/reports')
  return data.reports
}

/** Vision pass over a clinical report — returns a proposal, saves nothing. */
export async function analyzeReport(pages: PageImage[]): Promise<ReportAnalysis> {
  return request<ReportAnalysis>('/api/reports/analyze', jsonInit('POST', { pages }))
}

export interface SaveReportInput {
  date: string
  title: string
  specialty: string
  region: string
  stage: string
  stageSource: 'ai' | 'user'
  stageRationale: string
  summary: string
  findings: string[]
  followUp: string
  fileName: string
  /** original document, kept alongside the record */
  fileBase64?: string
  mime?: string
}

export async function saveReport(input: SaveReportInput): Promise<ClinicalReport> {
  return request<ClinicalReport>('/api/reports', jsonInit('POST', input))
}

export async function patchReport(
  id: string,
  patch: { date?: string; region?: string; stage?: string; title?: string; specialty?: string },
): Promise<ClinicalReport> {
  return request<ClinicalReport>(`/api/reports/${id}`, jsonInit('PATCH', patch))
}

export async function deleteReport(id: string): Promise<void> {
  await request(`/api/reports/${id}`, { method: 'DELETE' })
}

export function reportFileUrl(id: string): string {
  return `/api/reports/${id}/file`
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
