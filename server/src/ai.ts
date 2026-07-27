import { deleteSetting, getSetting, setSetting } from './db.js'

/* --------------------------- AI configuration --------------------------- */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-5.6-luna'

export interface AiConfig {
  baseUrl: string
  model: string
  hasKey: boolean
}

/** Env vars take precedence over settings stored in the DB. */
export function resolveConfig(): AiConfig & { apiKey: string | null } {
  const apiKey = process.env.AI_API_KEY || getSetting('ai_api_key')
  const baseUrl = (process.env.AI_BASE_URL || getSetting('ai_base_url') || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = process.env.AI_MODEL || getSetting('ai_model') || DEFAULT_MODEL
  return { baseUrl, model, apiKey: apiKey || null, hasKey: Boolean(apiKey) }
}

export function publicConfig(): AiConfig {
  const { baseUrl, model, hasKey } = resolveConfig()
  return { baseUrl, model, hasKey }
}

export function updateConfig(input: { baseUrl?: string; model?: string; apiKey?: string }): AiConfig {
  if (input.baseUrl !== undefined) {
    const v = input.baseUrl.trim().replace(/\/+$/, '')
    if (v) setSetting('ai_base_url', v)
    else deleteSetting('ai_base_url')
  }
  if (input.model !== undefined) {
    const v = input.model.trim()
    if (v) setSetting('ai_model', v)
    else deleteSetting('ai_model')
  }
  if (input.apiKey !== undefined) {
    const v = input.apiKey.trim()
    if (v) setSetting('ai_api_key', v)
    else deleteSetting('ai_api_key')
  }
  return publicConfig()
}

/* --------------------------- vision extraction --------------------------- */

const EXTRACTION_PROMPT = `You are a medical laboratory report parser. Extract ALL biomarker results visible in this image of a lab report page.

Return ONLY a JSON object (no markdown, no commentary) with this exact shape:
{
  "date": "YYYY-MM-DD" | null,
  "source": string | null,
  "biomarkers": [
    {
      "name": string,
      "value": number,
      "unit": string | null,
      "refLow": number | null,
      "refHigh": number | null,
      "flag": "low" | "normal" | "high" | "unknown",
      "category": string
    }
  ]
}

Rules:
- "date" is the report's own COLLECTION/sample date (not the print date, never the patient's date of birth). null if not visible on this page.
- "source" is the laboratory or clinic name if visible, else null.
- NEVER invent, estimate or round values; copy them exactly as printed. Convert decimal commas to decimal points.
- Preserve the printed reference range: refLow/refHigh as numbers; use null for a missing bound (e.g. "<200" => refLow null, refHigh 200). If no range is printed, both are null.
- "flag": respect the report's own printed H/L (or High/Low) flag when present; otherwise compute from the reference range; "unknown" when no range exists.
- "category" must be exactly one of: CBC, Lipids, Liver, Kidney, Thyroid, Vitamins, Minerals, Hormones, Inflammation, Glucose, Metabolic, Coagulation, Other.
- Include every analyte row you can read, including differentials and calculated indices. Skip headers, patient demographics and notes.`

export interface AiBiomarker {
  name: string
  value: number
  unit: string | null
  refLow: number | null
  refHigh: number | null
  flag: 'low' | 'normal' | 'high' | 'unknown'
  category: string
}

export interface AiPageResult {
  date: string | null
  source: string | null
  biomarkers: AiBiomarker[]
}

const VALID_FLAGS = new Set(['low', 'normal', 'high', 'unknown'])

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Tolerate ```json fences / surrounding prose: extract the first {...} block. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('Model returned no JSON object.')
  return JSON.parse(candidate.slice(start, end + 1))
}

function validatePageResult(raw: unknown): AiPageResult {
  if (typeof raw !== 'object' || raw === null) throw new Error('Model JSON is not an object.')
  const obj = raw as Record<string, unknown>
  const date = typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) ? obj.date : null
  const source = typeof obj.source === 'string' && obj.source.trim() !== '' ? obj.source.trim() : null
  const list = Array.isArray(obj.biomarkers) ? obj.biomarkers : []
  const biomarkers: AiBiomarker[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const b = item as Record<string, unknown>
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    const value = asNum(b.value)
    if (name.length < 2 || value === null) continue
    const flag = VALID_FLAGS.has(b.flag as string) ? (b.flag as AiBiomarker['flag']) : 'unknown'
    biomarkers.push({
      name,
      value,
      unit: typeof b.unit === 'string' && b.unit.trim() !== '' ? b.unit.trim() : null,
      refLow: asNum(b.refLow),
      refHigh: asNum(b.refHigh),
      flag,
      category: typeof b.category === 'string' && b.category.trim() !== '' ? b.category.trim() : 'Other',
    })
  }
  return { date, source, biomarkers }
}

type ChatMessage = Record<string, unknown>

/**
 * Shared chat-completions call with retry/backoff.
 * Sends ONLY `model` (+ optional AI_TEMPERATURE) and `messages` — no other
 * params, so models that reject extras (reasoning models, local servers)
 * are tolerated. `validate` runs inside the retry loop: a validation failure
 * is treated as retryable (the model may return clean output next attempt).
 */
async function postChatWithRetry<T>(messages: ChatMessage[], validate: (content: string) => T): Promise<T> {
  const { baseUrl, model, apiKey } = resolveConfig()
  if (!apiKey) {
    throw Object.assign(new Error('Add your API key in Settings.'), { code: 'NO_API_KEY' })
  }
  const requestBody = JSON.stringify({
    model,
    // Newer OpenAI models (gpt-5.x) reject non-default temperature values,
    // so it is omitted unless explicitly overridden via AI_TEMPERATURE.
    ...(process.env.AI_TEMPERATURE ? { temperature: Number(process.env.AI_TEMPERATURE) } : {}),
    messages,
  })

  const MAX_ATTEMPTS = 3
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const err = new Error(`AI provider error ${res.status}: ${body.slice(0, 300)}`)
        // 4xx (except 429) is deterministic — do not retry.
        if (res.status >= 500 || res.status === 429) throw Object.assign(err, { retryable: true })
        throw err
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
      }
      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw Object.assign(
          new Error(`Model returned an empty response (finish_reason: ${data.choices?.[0]?.finish_reason ?? '?'}).`),
          { retryable: true },
        )
      }
      try {
        return validate(content)
      } catch (parseErr) {
        console.warn('[ai] invalid model response:', content.slice(0, 300))
        throw Object.assign(parseErr instanceof Error ? parseErr : new Error(String(parseErr)), { retryable: true })
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      lastErr = e
      const retryable = (e as Error & { retryable?: boolean }).retryable || e.name === 'AbortError'
      if (!retryable || attempt === MAX_ATTEMPTS) throw e
      console.warn(`[ai] attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying: ${e.message.slice(0, 160)}`)
      // Provider throttling (429/503) needs real breathing room.
      await new Promise((r) => setTimeout(r, attempt * 8000))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr ?? new Error('AI request failed.')
}

async function chatCompletion(imageBase64: string, mime: string): Promise<AiPageResult> {
  return postChatWithRetry(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
        ],
      },
    ],
    (content) => validatePageResult(extractJson(content)),
  )
}

export interface ExtractPageInput {
  name: string
  imageBase64: string
  mime?: string
}

export interface ExtractFileResult {
  fileName: string
  date: string | null
  source: string | null
  biomarkers: AiBiomarker[]
  error?: string
}

const MAX_PAGES_PER_FILE = 10
const MAX_TOTAL_IMAGES = 30

/** Group pages by file name; one vision call per page; merge into one result per file. */
export async function extractWithAI(pages: ExtractPageInput[]): Promise<ExtractFileResult[]> {
  if (!resolveConfig().hasKey) {
    throw Object.assign(new Error('Add your API key in Settings.'), { code: 'NO_API_KEY' })
  }
  if (pages.length > MAX_TOTAL_IMAGES) {
    throw Object.assign(new Error(`Too many pages in one request (max ${MAX_TOTAL_IMAGES}).`), { code: 'BAD_REQUEST' })
  }
  const byFile = new Map<string, ExtractPageInput[]>()
  for (const p of pages) {
    const list = byFile.get(p.name) ?? []
    if (list.length < MAX_PAGES_PER_FILE) list.push(p)
    byFile.set(p.name, list)
  }

  const results: ExtractFileResult[] = []
  for (const [fileName, filePages] of byFile) {
    const merged: ExtractFileResult = { fileName, date: null, source: null, biomarkers: [] }
    const seen = new Set<string>()
    try {
      for (const page of filePages) {
        const r = await chatCompletion(page.imageBase64, page.mime ?? 'image/jpeg')
        if (!merged.date && r.date) merged.date = r.date
        if (!merged.source && r.source) merged.source = r.source
        for (const b of r.biomarkers) {
          const key = b.name.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          merged.biomarkers.push(b)
        }
      }
      if (merged.biomarkers.length === 0) merged.error = 'The model found no biomarker rows on these pages.'
    } catch (err) {
      merged.error = err instanceof Error ? err.message : String(err)
    }
    results.push(merged)
  }
  return results
}

/* ----------------------- organ-system explanations ----------------------- */

export interface ExplainMarker {
  name: string
  value: number
  unit?: string
  refLow?: number | null
  refHigh?: number | null
  flag?: string
}

const REGION_LABELS: Record<string, string> = {
  neck: 'thyroid & hormones (neck)',
  heart: 'heart & lipids',
  lungs: 'lungs & inflammation markers',
  liver: 'liver',
  gut: 'gut & glucose metabolism',
  kidney: 'kidneys',
  systemic: 'blood & systemic markers',
}

function buildExplainPrompt(region: string, markers: ExplainMarker[], date?: string): string {
  const lines = markers.map((m) => {
    const range =
      m.refLow != null || m.refHigh != null
        ? ` (reference ${m.refLow ?? '–'} – ${m.refHigh ?? '–'})`
        : ' (no reference range)'
    return `- ${m.name}: ${m.value}${m.unit ? ` ${m.unit}` : ''}${range} — ${(m.flag ?? 'unknown').toUpperCase()}`
  })
  return `You are a careful health-information assistant inside a personal biomarker dashboard. The user clicked the "${
    REGION_LABELS[region] ?? region
  }" organ system on a body map.${date ? ` Test date: ${date}.` : ''}

Their results in this group:
${lines.join('\n')}

Explain in 3-5 plain-language sentences what these results mean for a layperson: what each flagged marker measures, what a HIGH or LOW value commonly suggests, and everyday context (diet, hydration, lifestyle) where relevant.

Rules:
- NEVER diagnose or state diseases as certainties; use "can be associated with", "may suggest".
- NEVER invent values, markers or patient details not listed above.
- Note that reference ranges vary between laboratories.
- End with a calm suggestion to discuss persistent or concerning results with their doctor.
- No markdown, no bullet points, no headers — flowing sentences only.`
}

/** Plain-language explanation of one organ-system's results. Text-only call. */
export async function explainRegion(region: string, markers: ExplainMarker[], date?: string): Promise<string> {
  if (markers.length === 0) throw Object.assign(new Error('markers must be a non-empty array'), { code: 'BAD_REQUEST' })
  return postChatWithRetry([{ role: 'user', content: buildExplainPrompt(region, markers, date) }], (content) =>
    content.trim(),
  )
}

/* ------------------------- single-marker meaning ------------------------- */

function buildMarkerPrompt(m: ExplainMarker & { category?: string }): string {
  const range =
    m.refLow != null || m.refHigh != null
      ? `reference range ${m.refLow ?? '–'} – ${m.refHigh ?? '–'}`
      : 'no reference range available'
  return `You are a careful health-information assistant inside a personal biomarker dashboard. Explain one blood-test result to a layperson.

Marker: ${m.name}${m.category ? ` (category: ${m.category})` : ''}
Result: ${m.value}${m.unit ? ` ${m.unit}` : ''} — ${range} — flag: ${(m.flag ?? 'unknown').toUpperCase()}

Explain in 2-3 plain-language sentences: what this marker measures in the body, and what THIS specific value means given the range (in range / above / below, and by roughly how much in everyday terms).

Rules:
- NEVER diagnose or state diseases as certainties; use "can be associated with", "may suggest".
- NEVER invent values or patient details.
- Note that reference ranges vary between laboratories.
- If the value is outside the range, end with a calm note that a doctor can put it in context; do not alarm.
- No markdown, no bullet points — flowing sentences only.`
}

/** Plain-language meaning of one marker value. Text-only call. */
export async function explainMarker(m: ExplainMarker & { category?: string }): Promise<string> {
  if (!m.name || !Number.isFinite(m.value)) {
    throw Object.assign(new Error('marker needs a name and a numeric value'), { code: 'BAD_REQUEST' })
  }
  return postChatWithRetry([{ role: 'user', content: buildMarkerPrompt(m) }], (content) => content.trim())
}

/* ------------------------- full-panel analysis -------------------------- */

export interface AnalysisMarker extends ExplainMarker {
  category?: string
}

function buildAnalysisPrompt(markers: AnalysisMarker[], date?: string): string {
  const lines = markers.map((m) => {
    const range =
      m.refLow != null || m.refHigh != null
        ? ` (reference ${m.refLow ?? '–'} – ${m.refHigh ?? '–'})`
        : ' (no reference range)'
    const cat = m.category ? ` [${m.category}]` : ''
    return `- ${m.name}${cat}: ${m.value}${m.unit ? ` ${m.unit}` : ''}${range} — ${(m.flag ?? 'unknown').toUpperCase()}`
  })
  return `You are a careful health-information assistant inside a personal biomarker dashboard. The user asked for a general analysis of a full blood-test panel${date ? ` from ${date}` : ''}.

Complete panel:
${lines.join('\n')}

Write a general assessment in this exact format:
1. One short, GENERIC overview paragraph (2 sentences maximum): just the big picture — whether the panel is broadly reassuring or has areas to watch, and one line naming the main attention areas by theme only (no individual values, no numbers).
2. Then 3-6 bullet points (lines starting with "- "), each grouped by theme (e.g. lipids, liver, glucose, blood count): what looks good and what deserves attention, with the specific values.

Rules:
- The opening paragraph must stay generic — specific values belong ONLY in the bullets.
- NEVER diagnose or state diseases as certainties; use "can be associated with", "may suggest".
- NEVER invent values, markers or patient details not listed above.
- Note that reference ranges vary between laboratories.
- End the last bullet with a calm suggestion to discuss persistent or concerning results with their doctor.
- Output only the paragraph and the bullet lines — no headers, no bold, no numbering.`
}

/** General plain-language analysis of a full panel. Text-only call. */
export async function analyzePanel(markers: AnalysisMarker[], date?: string): Promise<string> {
  if (markers.length === 0) throw Object.assign(new Error('markers must be a non-empty array'), { code: 'BAD_REQUEST' })
  return postChatWithRetry([{ role: 'user', content: buildAnalysisPrompt(markers, date) }], (content) =>
    content.trim(),
  )
}

/** Cheap connectivity check: list models (or report the provider error). */
export async function testConnection(): Promise<{ ok: boolean; detail: string }> {  const { baseUrl, apiKey, hasKey } = resolveConfig()
  if (!hasKey || !apiKey) return { ok: false, detail: 'No API key configured.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, detail: `Provider returned ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = (await res.json()) as { data?: unknown[] }
    return { ok: true, detail: `Connected — ${Array.isArray(data.data) ? data.data.length : '?'} models visible.` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}
