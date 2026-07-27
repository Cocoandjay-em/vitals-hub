import type { TestRecord } from '@/types/biomarker'

/**
 * Persistence now lives in the backend (SQLite via /api/*).
 * This module keeps only JSON export/import and the one-time migration
 * of legacy localStorage history (key `vitals-hud-history-v1`).
 */

const LEGACY_KEY = 'vitals-hud-history-v1'

function isTestRecord(v: unknown): v is TestRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.date === 'string' &&
    Array.isArray(r.sources) &&
    Array.isArray(r.markers)
  )
}

/** Read history stored by the pre-backend version of the app. */
export function loadLegacyHistory(): TestRecord[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTestRecord).sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

export function clearLegacyHistory(): void {
  localStorage.removeItem(LEGACY_KEY)
}

export function exportHistory(history: TestRecord[]): void {
  const payload = {
    app: 'vitals-hud',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: history,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vitals-hud-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Parse an exported JSON file. Throws on invalid content. */
export function parseImport(json: string): TestRecord[] {
  const data: unknown = JSON.parse(json)
  const records: unknown =
    typeof data === 'object' && data !== null && Array.isArray((data as Record<string, unknown>).records)
      ? (data as Record<string, unknown>).records
      : data
  if (!Array.isArray(records)) throw new Error('No records array found in file.')
  const valid = records.filter(isTestRecord)
  if (valid.length === 0) throw new Error('File contained no valid test records.')
  return valid
}
