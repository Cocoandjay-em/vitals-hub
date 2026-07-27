import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(join(DATA_DIR, 'biomarkers.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  sources TEXT NOT NULL DEFAULT '[]',
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS biomarkers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  category TEXT NOT NULL DEFAULT 'Other',
  value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  ref_low REAL,
  ref_high REAL,
  flag TEXT NOT NULL DEFAULT 'unknown',
  UNIQUE(test_id, name)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`)

/* ------------------------------- types ------------------------------- */

export interface BiomarkerRow {
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

export interface TestRow {
  id: string
  date: string
  sources: string[]
  demo: boolean
  createdAt: string
}

export interface BiomarkerInput {
  name: string
  category?: string
  value: number
  unit?: string
  refLow?: number | null
  refHigh?: number | null
  flag?: string
}

/* ----------------------------- test CRUD ----------------------------- */

interface TestDbRow {
  id: string
  date: string
  sources: string
  demo: number
  created_at: string
}

interface BiomarkerDbRow {
  id: number
  test_id: string
  name: string
  category: string
  value: number
  unit: string
  ref_low: number | null
  ref_high: number | null
  flag: string
}

function mapTest(r: TestDbRow): TestRow {
  let sources: string[] = []
  try {
    const parsed: unknown = JSON.parse(r.sources)
    if (Array.isArray(parsed)) sources = parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    /* keep empty */
  }
  return { id: r.id, date: r.date, sources, demo: r.demo === 1, createdAt: r.created_at }
}

function mapBiomarker(r: BiomarkerDbRow): BiomarkerRow {
  return {
    id: r.id,
    testId: r.test_id,
    name: r.name,
    category: r.category,
    value: r.value,
    unit: r.unit,
    refLow: r.ref_low,
    refHigh: r.ref_high,
    flag: r.flag,
  }
}

export function getHistory(): { tests: TestRow[]; biomarkers: BiomarkerRow[] } {
  const tests = (db.prepare('SELECT * FROM tests ORDER BY date ASC').all() as TestDbRow[]).map(mapTest)
  const biomarkers = (
    db
      .prepare(
        'SELECT b.* FROM biomarkers b JOIN tests t ON t.id = b.test_id ORDER BY t.date ASC, b.name ASC',
      )
      .all() as BiomarkerDbRow[]
  ).map(mapBiomarker)
  return { tests, biomarkers }
}

function uid(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Create or merge a test record by date; same-name biomarkers are overwritten. */
export function upsertTest(input: {
  date: string
  source: string
  demo?: boolean
  biomarkers: BiomarkerInput[]
}): { test: TestRow; biomarkers: BiomarkerRow[] } {
  const tx = db.transaction(() => {
    let row = db.prepare('SELECT * FROM tests WHERE date = ?').get(input.date) as TestDbRow | undefined
    if (!row) {
      const id = uid()
      db.prepare('INSERT INTO tests (id, date, sources, demo, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        input.date,
        JSON.stringify([input.source]),
        input.demo ? 1 : 0,
        new Date().toISOString(),
      )
      row = db.prepare('SELECT * FROM tests WHERE id = ?').get(id) as TestDbRow
    } else {
      const current = mapTest(row)
      const sources = current.sources.includes(input.source)
        ? current.sources
        : [...current.sources, input.source]
      db.prepare('UPDATE tests SET sources = ?, demo = MAX(demo, ?) WHERE id = ?').run(
        JSON.stringify(sources),
        input.demo ? 1 : 0,
        row.id,
      )
      row = db.prepare('SELECT * FROM tests WHERE id = ?').get(row.id) as TestDbRow
    }

    const insert = db.prepare(`
      INSERT INTO biomarkers (test_id, name, category, value, unit, ref_low, ref_high, flag)
      VALUES (@testId, @name, @category, @value, @unit, @refLow, @refHigh, @flag)
      ON CONFLICT(test_id, name) DO UPDATE SET
        category = excluded.category,
        value = excluded.value,
        unit = excluded.unit,
        ref_low = excluded.ref_low,
        ref_high = excluded.ref_high,
        flag = excluded.flag
    `)
    for (const m of input.biomarkers) {
      insert.run({
        testId: row.id,
        name: m.name,
        category: m.category ?? 'Other',
        value: m.value,
        unit: m.unit ?? '',
        refLow: m.refLow ?? null,
        refHigh: m.refHigh ?? null,
        flag: m.flag ?? 'unknown',
      })
    }
    return row.id
  })

  const testId = tx()
  const test = mapTest(db.prepare('SELECT * FROM tests WHERE id = ?').get(testId) as TestDbRow)
  const biomarkers = (
    db.prepare('SELECT * FROM biomarkers WHERE test_id = ? ORDER BY name ASC').all(testId) as BiomarkerDbRow[]
  ).map(mapBiomarker)
  return { test, biomarkers }
}

export function deleteMarker(id: number): boolean {
  // drop the parent test too when it becomes empty
  const row = db.prepare('SELECT test_id FROM biomarkers WHERE id = ?').get(id) as { test_id: string } | undefined
  if (!row) return false
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM biomarkers WHERE id = ?').run(id)
    db.prepare('DELETE FROM tests WHERE id = ? AND NOT EXISTS (SELECT 1 FROM biomarkers WHERE test_id = ?)').run(
      row.test_id,
      row.test_id,
    )
  })
  tx()
  return true
}

export function deleteTest(id: string): boolean {
  const info = db.prepare('DELETE FROM tests WHERE id = ?').run(id)
  return info.changes > 0
}

export function clearHistory(): void {
  db.exec('DELETE FROM biomarkers; DELETE FROM tests;')
}

/* ------------------------------ settings ------------------------------ */

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  )
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}
