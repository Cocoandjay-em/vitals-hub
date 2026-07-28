import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Where the database and stored report documents live. Override with DATA_DIR
 * to keep state outside the checkout — a mounted volume, /var/lib/..., or a
 * throwaway directory in tests.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : join(__dirname, '..', 'data')
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
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT 'systemic',
  stage TEXT NOT NULL DEFAULT 'unknown',
  stage_source TEXT NOT NULL DEFAULT 'ai',
  stage_rationale TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '[]',
  follow_up TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  mime TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_region_idx ON reports(region);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  birth_date TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL DEFAULT 'male',
  created_at TEXT NOT NULL
);
`)

/* ------------------------------ migration ------------------------------ */

function columnNames(table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  )
}

/**
 * One login can track several people — you, a partner, a child. Health data
 * therefore hangs off a *subject*, not off the account.
 *
 * The original schema was single-tenant: tests, biomarkers and reports had no
 * owner at all, and `tests.date` was globally UNIQUE, so two people could not
 * both have a test on the same day. This gives every existing row to a first
 * subject seeded from the stored profile, and rebuilds `tests` so uniqueness
 * is per subject. Guarded by the presence of tests.subject_id, so it runs once.
 */
function migrateToSubjects(): void {
  if (columnNames('tests').has('subject_id')) return

  const now = new Date().toISOString()
  const subjectId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const setting = (k: string) =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)
      ?.value ?? ''

  db.prepare(
    `INSERT INTO subjects (id, first_name, last_name, birth_date, sex, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    subjectId,
    setting('profile_first_name'),
    setting('profile_last_name'),
    setting('profile_birth_date'),
    setting('profile_sex') === 'female' ? 'female' : 'male',
    now,
  )

  if (!columnNames('reports').has('subject_id')) {
    db.exec('ALTER TABLE reports ADD COLUMN subject_id TEXT')
    db.prepare('UPDATE reports SET subject_id = ?').run(subjectId)
  }
  if (!columnNames('sessions').has('active_subject_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN active_subject_id TEXT')
  }

  // `tests` needs a real rebuild: SQLite cannot drop the UNIQUE(date).
  // foreign_keys OFF stops the DROP cascading into biomarkers, and
  // legacy_alter_table stops the RENAME repointing biomarkers.test_id.
  db.pragma('foreign_keys = OFF')
  db.pragma('legacy_alter_table = ON')
  db.transaction(() => {
    db.exec(`
      ALTER TABLE tests RENAME TO tests_legacy;
      CREATE TABLE tests (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        sources TEXT NOT NULL DEFAULT '[]',
        demo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(subject_id, date)
      );
    `)
    db.prepare(
      `INSERT INTO tests (id, subject_id, date, sources, demo, created_at)
       SELECT id, ?, date, sources, demo, created_at FROM tests_legacy`,
    ).run(subjectId)
    db.exec('DROP TABLE tests_legacy')
  })()
  db.pragma('legacy_alter_table = OFF')
  db.pragma('foreign_keys = ON')

  const orphans = db.pragma('foreign_key_check') as unknown[]
  if (orphans.length > 0) {
    console.error(`[db] WARNING: ${orphans.length} orphaned rows after migration`)
  }
  db.exec('CREATE INDEX IF NOT EXISTS tests_subject_idx ON tests(subject_id)')
  db.exec('CREATE INDEX IF NOT EXISTS reports_subject_idx ON reports(subject_id)')
  console.log('[db] migrated to the multi-subject schema')
}

migrateToSubjects()

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

export function getHistory(subjectId: string): { tests: TestRow[]; biomarkers: BiomarkerRow[] } {
  const tests = (
    db.prepare('SELECT * FROM tests WHERE subject_id = ? ORDER BY date ASC').all(subjectId) as TestDbRow[]
  ).map(mapTest)
  const biomarkers = (
    db
      .prepare(
        `SELECT b.* FROM biomarkers b JOIN tests t ON t.id = b.test_id
         WHERE t.subject_id = ? ORDER BY t.date ASC, b.name ASC`,
      )
      .all(subjectId) as BiomarkerDbRow[]
  ).map(mapBiomarker)
  return { tests, biomarkers }
}

function uid(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Create or merge a test record by date; same-name biomarkers are overwritten. */
export function upsertTest(input: {
  subjectId: string
  date: string
  source: string
  demo?: boolean
  biomarkers: BiomarkerInput[]
}): { test: TestRow; biomarkers: BiomarkerRow[] } {
  const tx = db.transaction(() => {
    // a date identifies a test within one person, not across everybody
    let row = db
      .prepare('SELECT * FROM tests WHERE subject_id = ? AND date = ?')
      .get(input.subjectId, input.date) as TestDbRow | undefined
    if (!row) {
      const id = uid()
      db.prepare(
        'INSERT INTO tests (id, subject_id, date, sources, demo, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        input.subjectId,
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

/** Wipe one person's history, leaving everyone else's untouched. */
export function clearHistory(subjectId: string): void {
  db.transaction(() => {
    db.prepare(
      'DELETE FROM biomarkers WHERE test_id IN (SELECT id FROM tests WHERE subject_id = ?)',
    ).run(subjectId)
    db.prepare('DELETE FROM tests WHERE subject_id = ?').run(subjectId)
  })()
}

/* --------------------------- clinical reports --------------------------- */

export interface ReportRow {
  id: string
  date: string
  title: string
  specialty: string
  region: string
  stage: string
  stageSource: string
  stageRationale: string
  summary: string
  findings: string[]
  followUp: string
  fileName: string
  hasFile: boolean
  createdAt: string
}

interface ReportDbRow {
  id: string
  date: string
  title: string
  specialty: string
  region: string
  stage: string
  stage_source: string
  stage_rationale: string
  summary: string
  findings: string
  follow_up: string
  file_name: string
  file_path: string | null
  mime: string | null
  created_at: string
}

function mapReport(r: ReportDbRow): ReportRow {
  let findings: string[] = []
  try {
    const parsed: unknown = JSON.parse(r.findings)
    if (Array.isArray(parsed)) findings = parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    /* keep empty */
  }
  return {
    id: r.id,
    date: r.date,
    title: r.title,
    specialty: r.specialty,
    region: r.region,
    stage: r.stage,
    stageSource: r.stage_source,
    stageRationale: r.stage_rationale,
    summary: r.summary,
    findings,
    followUp: r.follow_up,
    fileName: r.file_name,
    hasFile: !!r.file_path,
    createdAt: r.created_at,
  }
}

export interface ReportInput {
  subjectId: string
  date: string
  title: string
  specialty: string
  region: string
  stage: string
  stageSource: string
  stageRationale: string
  summary: string
  findings: string[]
  followUp: string
  fileName: string
  filePath: string | null
  mime: string | null
}

export function getReports(subjectId: string): ReportRow[] {
  return (
    db
      .prepare('SELECT * FROM reports WHERE subject_id = ? ORDER BY date DESC, created_at DESC')
      .all(subjectId) as ReportDbRow[]
  ).map(mapReport)
}

export function insertReport(id: string, input: ReportInput): ReportRow {
  db.prepare(
    `INSERT INTO reports
       (id, subject_id, date, title, specialty, region, stage, stage_source, stage_rationale,
        summary, findings, follow_up, file_name, file_path, mime, created_at)
     VALUES
       (@id, @subjectId, @date, @title, @specialty, @region, @stage, @stageSource, @stageRationale,
        @summary, @findings, @followUp, @fileName, @filePath, @mime, @createdAt)`,
  ).run({
    id,
    subjectId: input.subjectId,
    date: input.date,
    title: input.title,
    specialty: input.specialty,
    region: input.region,
    stage: input.stage,
    stageSource: input.stageSource,
    stageRationale: input.stageRationale,
    summary: input.summary,
    findings: JSON.stringify(input.findings),
    followUp: input.followUp,
    fileName: input.fileName,
    filePath: input.filePath,
    mime: input.mime,
    createdAt: new Date().toISOString(),
  })
  return mapReport(db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportDbRow)
}

/** Partial update — used by the user's stage / region / date overrides. */
export function updateReport(
  id: string,
  patch: Partial<Pick<ReportInput, 'date' | 'title' | 'specialty' | 'region' | 'stage' | 'stageSource'>>,
): ReportRow | null {
  const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportDbRow | undefined
  if (!existing) return null
  const columns: Record<string, string> = {
    date: 'date',
    title: 'title',
    specialty: 'specialty',
    region: 'region',
    stage: 'stage',
    stageSource: 'stage_source',
  }
  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch]
    if (value !== undefined) db.prepare(`UPDATE reports SET ${column} = ? WHERE id = ?`).run(value, id)
  }
  return mapReport(db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportDbRow)
}

/** Returns the stored file path (if any) so the caller can unlink it. */
export function deleteReport(id: string): { deleted: boolean; filePath: string | null } {
  const row = db.prepare('SELECT file_path FROM reports WHERE id = ?').get(id) as
    | { file_path: string | null }
    | undefined
  if (!row) return { deleted: false, filePath: null }
  db.prepare('DELETE FROM reports WHERE id = ?').run(id)
  return { deleted: true, filePath: row.file_path }
}

export function getReportFile(id: string): { filePath: string; mime: string | null; fileName: string } | null {
  const row = db.prepare('SELECT file_path, mime, file_name FROM reports WHERE id = ?').get(id) as
    | { file_path: string | null; mime: string | null; file_name: string }
    | undefined
  if (!row?.file_path) return null
  return { filePath: row.file_path, mime: row.mime, fileName: row.file_name }
}

/* --------------------------- users & sessions --------------------------- */

export interface UserRow {
  id: string
  username: string
  passwordHash: string
  createdAt: string
}

interface UserDbRow {
  id: string
  username: string
  password_hash: string
  created_at: string
}

function mapUser(r: UserDbRow): UserRow {
  return { id: r.id, username: r.username, passwordHash: r.password_hash, createdAt: r.created_at }
}

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
}

export function createUser(id: string, username: string, passwordHash: string): void {
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    username,
    passwordHash,
    new Date().toISOString(),
  )
}

export function findUserByName(username: string): UserRow | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserDbRow | undefined
  return row ? mapUser(row) : null
}

export function getUserById(id: string): UserRow | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserDbRow | undefined
  return row ? mapUser(row) : null
}

export function updateUserPassword(id: string, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id)
}

export function createSession(tokenHash: string, userId: string, expiresAt: string): void {
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(tokenHash, userId, expiresAt, new Date().toISOString())
}

/**
 * Look up a live session and slide its expiry forward. Returns null for an
 * unknown or expired token, so an expired row can never authenticate.
 */
export function touchSession(tokenHash: string, newExpiry: string): { userId: string } | null {
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
    | { user_id: string; expires_at: string }
    | undefined
  if (!row) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return null
  }
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(newExpiry, tokenHash)
  return { userId: row.user_id }
}

export function deleteSession(tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
}

export function deleteSessionsForUser(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function purgeExpiredSessions(): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
}

/* ------------------------------ subjects ------------------------------ */

export interface SubjectRow {
  id: string
  firstName: string
  lastName: string
  /** ISO yyyy-mm-dd, empty when not set */
  birthDate: string
  sex: string
  createdAt: string
}

interface SubjectDbRow {
  id: string
  first_name: string
  last_name: string
  birth_date: string
  sex: string
  created_at: string
}

function mapSubject(r: SubjectDbRow): SubjectRow {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    birthDate: r.birth_date,
    sex: r.sex,
    createdAt: r.created_at,
  }
}

export function listSubjects(): SubjectRow[] {
  return (
    db.prepare('SELECT * FROM subjects ORDER BY created_at ASC').all() as SubjectDbRow[]
  ).map(mapSubject)
}

export function getSubject(id: string): SubjectRow | null {
  const row = db.prepare('SELECT * FROM subjects WHERE id = ?').get(id) as SubjectDbRow | undefined
  return row ? mapSubject(row) : null
}

export interface SubjectInput {
  firstName?: string
  lastName?: string
  birthDate?: string
  sex?: string
}

export function createSubject(input: SubjectInput): SubjectRow {
  const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  db.prepare(
    `INSERT INTO subjects (id, first_name, last_name, birth_date, sex, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.firstName ?? '',
    input.lastName ?? '',
    input.birthDate ?? '',
    input.sex === 'female' ? 'female' : 'male',
    new Date().toISOString(),
  )
  return getSubject(id) as SubjectRow
}

export function updateSubject(id: string, input: SubjectInput): SubjectRow | null {
  if (!getSubject(id)) return null
  const columns: Record<string, string> = {
    firstName: 'first_name',
    lastName: 'last_name',
    birthDate: 'birth_date',
    sex: 'sex',
  }
  for (const [key, column] of Object.entries(columns)) {
    const value = input[key as keyof SubjectInput]
    if (value !== undefined) db.prepare(`UPDATE subjects SET ${column} = ? WHERE id = ?`).run(value, id)
  }
  return getSubject(id)
}

/**
 * Remove a person and everything recorded about them. Returns the stored
 * report files so the caller can unlink them; refuses to delete the last
 * subject, since the app always needs someone to show.
 */
export function deleteSubject(id: string): { deleted: boolean; filePaths: string[] } {
  if (listSubjects().length <= 1) return { deleted: false, filePaths: [] }
  const files = (
    db.prepare('SELECT file_path FROM reports WHERE subject_id = ? AND file_path IS NOT NULL').all(id) as {
      file_path: string
    }[]
  ).map((r) => r.file_path)
  db.transaction(() => {
    clearHistory(id)
    db.prepare('DELETE FROM reports WHERE subject_id = ?').run(id)
    db.prepare('UPDATE sessions SET active_subject_id = NULL WHERE active_subject_id = ?').run(id)
    db.prepare('DELETE FROM subjects WHERE id = ?').run(id)
  })()
  return { deleted: true, filePaths: files }
}

/** The subject a session is currently looking at, falling back to the first. */
export function getActiveSubjectId(tokenHash: string): string {
  const row = db.prepare('SELECT active_subject_id FROM sessions WHERE token_hash = ?').get(tokenHash) as
    | { active_subject_id: string | null }
    | undefined
  if (row?.active_subject_id && getSubject(row.active_subject_id)) return row.active_subject_id
  const first = listSubjects()[0]
  return first ? first.id : createSubject({}).id
}

export function setActiveSubjectId(tokenHash: string, subjectId: string): void {
  db.prepare('UPDATE sessions SET active_subject_id = ? WHERE token_hash = ?').run(subjectId, tokenHash)
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
