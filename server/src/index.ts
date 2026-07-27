/**
 * Vitals Hub — backend entrypoint.
 *
 * Single-process Express server:
 *   /api/*            REST API (history, markers, settings, AI extraction)
 *   everything else   static frontend from ../../dist (production)
 *
 * Dev: run `npm run dev` — Vite on 3000 proxies /api to this server on 3101.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env lives in server/ regardless of where the process was started from
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import express from 'express';
import {
  clearHistory,
  deleteMarker,
  DATA_DIR,
  deleteReport,
  deleteTest,
  getHistory,
  getReportFile,
  getReports,
  getSetting,
  insertReport,
  setSetting,
  updateReport,
  upsertTest,
} from './db.js';
import {
  analyzePanel,
  analyzeReport,
  explainMarker,
  explainRegion,
  extractWithAI,
  publicConfig,
  testConnection,
  updateConfig,
} from './ai.js';
import {
  authenticate,
  changePassword,
  clearFailures,
  clearSession,
  currentUser,
  isConfigured,
  issueSession,
  lockoutRemainingMs,
  passwordProblem,
  recordFailure,
  requireAuth,
  setupFirstUser,
  startSessionCleanup,
  usernameProblem,
} from './auth.js';

const app = express();
// Caddy/nginx terminate TLS in front of us: trust one proxy hop so req.ip is
// the real client (login throttling) and req.secure reflects the outer scheme.
app.set('trust proxy', 1);
app.use(express.json({ limit: '60mb' })); // rasterized PDF pages are chunky

// every /api route below requires a session, except the public ones listed in auth.ts
app.use('/api', requireAuth);
startSessionCleanup();

// ---------- authentication ----------

app.get('/api/auth/status', (req, res) => {
  const user = currentUser(req);
  res.json({
    configured: isConfigured(),
    authenticated: !!user,
    username: user?.username ?? null,
  });
});

/** First run only: create the single owner account. */
app.post('/api/auth/setup', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const problem = usernameProblem(username) ?? passwordProblem(password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  // the profile is optional here — it can also be filled in later under ACCOUNT
  const profileIssue = profileProblem((req.body ?? {}) as Record<string, unknown>);
  if (profileIssue) {
    res.status(400).json({ error: profileIssue });
    return;
  }
  try {
    const user = setupFirstUser(username, password);
    writeProfile((req.body ?? {}) as Record<string, unknown>);
    issueSession(req, res, user.id);
    res.json({ username: user.username });
  } catch (err) {
    const e = err as Error & { code?: string };
    res.status(e.code === 'ALREADY_CONFIGURED' ? 409 : 500).json({ error: e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const waitMs = lockoutRemainingMs(req);
  if (waitMs > 0) {
    res
      .status(429)
      .json({ error: `Too many failed attempts. Try again in ${Math.ceil(waitMs / 60000)} minutes.` });
    return;
  }
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const user = authenticate(username, password);
  if (!user) {
    recordFailure(req);
    // deliberately vague: never reveal whether the username exists
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }
  clearFailures(req);
  issueSession(req, res, user.id);
  res.json({ username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

app.post('/api/auth/password', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
    return;
  }
  const problem = changePassword(
    user.id,
    String(req.body?.currentPassword ?? ''),
    String(req.body?.newPassword ?? ''),
  );
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  // every session was invalidated, including this one — issue a fresh one
  issueSession(req, res, user.id);
  res.json({ ok: true });
});

// ---------- helpers ----------

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---------- API ----------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/history', (_req, res) => {
  res.json(getHistory());
});

app.post('/api/tests', (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  if (!Array.isArray(b.biomarkers) || b.biomarkers.length === 0) {
    res.status(400).json({ error: 'biomarkers must be a non-empty array' });
    return;
  }
  const input = {
    date: b.date as string,
    source: String(
      b.source ??
        (Array.isArray(b.fileNames) && b.fileNames.length > 0
          ? b.fileNames.map(String).join(', ')
          : 'upload'),
    ),
    demo: !!b.demo,
    biomarkers: (b.biomarkers as Record<string, unknown>[]).map((m) => ({
      name: String(m.name ?? '').trim(),
      category: String(m.category ?? 'Other'),
      value: Number(m.value),
      unit: String(m.unit ?? ''),
      refLow: m.refLow == null ? null : Number(m.refLow),
      refHigh: m.refHigh == null ? null : Number(m.refHigh),
      flag: ['normal', 'low', 'high', 'critical', 'unknown'].includes(String(m.flag))
        ? String(m.flag)
        : 'unknown',
    })),
  };
  if (input.biomarkers.some((m) => !m.name || !Number.isFinite(m.value))) {
    res.status(400).json({ error: 'every biomarker needs a name and a numeric value' });
    return;
  }
  res.json(upsertTest(input));
});

app.delete('/api/markers/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid marker id' });
    return;
  }
  deleteMarker(id);
  res.json({ ok: true });
});

app.delete('/api/tests/:id', (req, res) => {
  deleteTest(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/history', (_req, res) => {
  clearHistory();
  res.json({ ok: true });
});

// ----- user profile (name, birth date, body model — in the settings table) -----

type ProfileSex = 'male' | 'female';
const PROFILE_DEFAULT: ProfileSex = 'male';

interface Profile {
  firstName: string;
  lastName: string;
  /** ISO yyyy-mm-dd, empty when not set */
  birthDate: string;
  sex: ProfileSex;
}

function readProfile(): Profile {
  return {
    firstName: getSetting('profile_first_name') ?? '',
    lastName: getSetting('profile_last_name') ?? '',
    birthDate: getSetting('profile_birth_date') ?? '',
    sex: getSetting('profile_sex') === 'female' ? 'female' : PROFILE_DEFAULT,
  };
}

/** null when acceptable, otherwise the reason to reject. */
function profileProblem(b: Record<string, unknown>): string | null {
  for (const field of ['firstName', 'lastName'] as const) {
    const v = b[field];
    if (v !== undefined && (typeof v !== 'string' || v.length > 80)) {
      return `${field} must be a string of at most 80 characters`;
    }
  }
  if (b.birthDate !== undefined && b.birthDate !== '') {
    if (!isIsoDate(b.birthDate)) return 'birthDate must be YYYY-MM-DD';
    const d = new Date(`${b.birthDate}T00:00:00Z`).getTime();
    if (Number.isNaN(d)) return 'birthDate is not a real date';
    if (d > Date.now()) return 'birthDate cannot be in the future';
    if (d < Date.UTC(1900, 0, 1)) return 'birthDate must be after 1900';
  }
  if (b.sex !== undefined && b.sex !== 'male' && b.sex !== 'female') {
    return "sex must be 'male' or 'female'";
  }
  return null;
}

/** Persist only the fields present in the payload. */
function writeProfile(b: Record<string, unknown>): void {
  if (b.firstName !== undefined) setSetting('profile_first_name', String(b.firstName).trim());
  if (b.lastName !== undefined) setSetting('profile_last_name', String(b.lastName).trim());
  if (b.birthDate !== undefined) setSetting('profile_birth_date', String(b.birthDate));
  if (b.sex !== undefined) setSetting('profile_sex', String(b.sex));
}

app.get('/api/profile', (_req, res) => {
  res.json(readProfile());
});

app.put('/api/profile', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const problem = profileProblem(b);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  writeProfile(b);
  res.json(readProfile());
});

// ----- AI settings -----

app.get('/api/config', (_req, res) => {
  res.json(publicConfig());
});

app.put('/api/config', (req, res) => {
  const b = req.body ?? {};
  updateConfig({
    baseUrl: b.baseUrl,
    model: b.model,
    apiKey: b.apiKey,
  });
  res.json(publicConfig());
});

app.get('/api/config/test', async (_req, res) => {
  const result = await testConnection();
  res.status(result.ok ? 200 : 502).json(result);
});

// ----- AI extraction -----

app.post('/api/extract', async (req, res) => {
  const pages = req.body?.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    res.status(400).json({ error: 'pages must be a non-empty array' });
    return;
  }
  try {
    const results = await extractWithAI(
      pages.map((p: Record<string, unknown>) => ({
        name: String(p.name ?? 'page'),
        imageBase64: String(p.imageBase64 ?? ''),
        mime: String(p.mime ?? 'image/jpeg'),
      })),
    );
    res.json({ results });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'NO_API_KEY') {
      res.status(400).json({ error: e.message, code: e.code });
      return;
    }
    console.error('[extract]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ----- AI organ explanations -----

app.post('/api/explain', async (req, res) => {
  const b = req.body ?? {};
  const region = typeof b.region === 'string' ? b.region.trim() : '';
  if (!region || !Array.isArray(b.markers) || b.markers.length === 0) {
    res.status(400).json({ error: 'region and a non-empty markers array are required' });
    return;
  }
  const markers = (b.markers as Record<string, unknown>[]).map((m) => ({
    name: String(m.name ?? '').trim(),
    value: Number(m.value),
    unit: m.unit == null ? '' : String(m.unit),
    refLow: m.refLow == null ? null : Number(m.refLow),
    refHigh: m.refHigh == null ? null : Number(m.refHigh),
    flag: ['normal', 'low', 'high', 'unknown'].includes(String(m.flag)) ? String(m.flag) : 'unknown',
  }));
  if (markers.some((m) => !m.name || !Number.isFinite(m.value))) {
    res.status(400).json({ error: 'every marker needs a name and a numeric value' });
    return;
  }
  try {
    const explanation = await explainRegion(
      region,
      markers,
      typeof b.date === 'string' && isIsoDate(b.date) ? b.date : undefined,
    );
    res.json({ explanation });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'NO_API_KEY') {
      res.status(400).json({ error: e.message, code: e.code });
      return;
    }
    console.error('[explain]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ----- AI full-panel analysis -----

app.post('/api/analysis', async (req, res) => {
  const b = req.body ?? {};
  if (!Array.isArray(b.markers) || b.markers.length === 0) {
    res.status(400).json({ error: 'markers must be a non-empty array' });
    return;
  }
  const markers = (b.markers as Record<string, unknown>[]).map((m) => ({
    name: String(m.name ?? '').trim(),
    value: Number(m.value),
    unit: m.unit == null ? '' : String(m.unit),
    refLow: m.refLow == null ? null : Number(m.refLow),
    refHigh: m.refHigh == null ? null : Number(m.refHigh),
    flag: ['normal', 'low', 'high', 'unknown'].includes(String(m.flag)) ? String(m.flag) : 'unknown',
    category: m.category == null ? 'Other' : String(m.category),
  }));
  if (markers.some((m) => !m.name || !Number.isFinite(m.value))) {
    res.status(400).json({ error: 'every marker needs a name and a numeric value' });
    return;
  }
  try {
    const analysis = await analyzePanel(
      markers,
      typeof b.date === 'string' && isIsoDate(b.date) ? b.date : undefined,
    );
    res.json({ analysis });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'NO_API_KEY') {
      res.status(400).json({ error: e.message, code: e.code });
      return;
    }
    console.error('[analysis]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ----- AI single-marker meaning -----

app.post('/api/explain-marker', async (req, res) => {
  const b = req.body ?? {};
  const marker = {
    name: String(b.name ?? '').trim(),
    value: Number(b.value),
    unit: b.unit == null ? '' : String(b.unit),
    refLow: b.refLow == null ? null : Number(b.refLow),
    refHigh: b.refHigh == null ? null : Number(b.refHigh),
    flag: ['normal', 'low', 'high', 'unknown'].includes(String(b.flag)) ? String(b.flag) : 'unknown',
    category: b.category == null ? undefined : String(b.category),
  };
  if (!marker.name || !Number.isFinite(marker.value)) {
    res.status(400).json({ error: 'marker needs a name and a numeric value' });
    return;
  }
  try {
    const explanation = await explainMarker(marker);
    res.json({ explanation });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'NO_API_KEY') {
      res.status(400).json({ error: e.message, code: e.code });
      return;
    }
    console.error('[explain-marker]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ----- Apple Health import -----

const APPLE_HEALTH_MAP: Record<
  string,
  { name: string; unit: string; refLow: number | null; refHigh: number | null }
> = {
  HKQuantityTypeIdentifierBloodPressureSystolic: {
    name: 'Blood Pressure Systolic', unit: 'mmHg', refLow: 90, refHigh: 120,
  },
  HKQuantityTypeIdentifierBloodPressureDiastolic: {
    name: 'Blood Pressure Diastolic', unit: 'mmHg', refLow: 60, refHigh: 80,
  },
  HKQuantityTypeIdentifierHeartRate: {
    name: 'Heart Rate', unit: 'bpm', refLow: 60, refHigh: 100,
  },
  HKQuantityTypeIdentifierBodyMass: {
    name: 'Weight', unit: 'kg', refLow: null, refHigh: null,
  },
  HKQuantityTypeIdentifierBodyTemperature: {
    name: 'Body Temperature', unit: '°C', refLow: 36.1, refHigh: 37.2,
  },
};

app.post('/api/import/apple-health', (req, res) => {
  const records = req.body?.records;
  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: 'records must be a non-empty array' });
    return;
  }
  if (records.length > 2000) {
    res.status(400).json({ error: 'too many records in one batch (max 2000)' });
    return;
  }
  // group valid records by day
  const byDate = new Map<string, { name: string; category: string; value: number; unit: string; refLow: number | null; refHigh: number | null; flag: string }[]>();
  let skipped = 0;
  for (const r of records as Record<string, unknown>[]) {
    const def = APPLE_HEALTH_MAP[String(r.type ?? '')];
    const value = Number(r.value);
    const date = String(r.date ?? '');
    if (!def || !Number.isFinite(value) || !isIsoDate(date)) {
      skipped++;
      continue;
    }
    const flag =
      def.refLow == null && def.refHigh == null
        ? 'unknown'
        : def.refLow != null && value < def.refLow
          ? 'low'
          : def.refHigh != null && value > def.refHigh
            ? 'high'
            : 'normal';
    const list = byDate.get(date) ?? [];
    list.push({ name: def.name, category: 'Other', value, unit: def.unit, refLow: def.refLow, refHigh: def.refHigh, flag });
    byDate.set(date, list);
  }
  let imported = 0;
  for (const [date, biomarkers] of byDate) {
    upsertTest({ date, source: 'Apple Health', biomarkers });
    imported += biomarkers.length;
  }
  res.json({ imported, days: byDate.size, skipped });
});

// ----- clinical reports (specialist visits attached to an organ) -----

const REPORT_REGIONS = ['brain', 'neck', 'heart', 'lungs', 'liver', 'gut', 'kidney', 'systemic'];
const REPORT_STAGES = ['normal', 'mild', 'moderate', 'severe', 'critical', 'unknown'];
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const MAX_REPORT_FILE_BYTES = 25 * 1024 * 1024;

/** Extension whitelist — the stored name is derived from the report id, never from user input. */
const REPORT_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function reportId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

app.get('/api/reports', (_req, res) => {
  res.json({ reports: getReports() });
});

/** Vision pass over a clinical report — proposes a staging, saves nothing. */
app.post('/api/reports/analyze', async (req, res) => {
  const pages = req.body?.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    res.status(400).json({ error: 'pages must be a non-empty array' });
    return;
  }
  try {
    const result = await analyzeReport(
      pages.map((p: Record<string, unknown>) => ({
        name: String(p.name ?? 'page'),
        imageBase64: String(p.imageBase64 ?? ''),
        mime: String(p.mime ?? 'image/jpeg'),
      })),
    );
    res.json(result);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'NO_API_KEY' || e.code === 'BAD_REQUEST') {
      res.status(400).json({ error: e.message, code: e.code });
      return;
    }
    console.error('[reports/analyze]', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/reports', (req, res) => {
  const b = req.body ?? {};
  if (!isIsoDate(b.date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  const region = REPORT_REGIONS.includes(String(b.region)) ? String(b.region) : 'systemic';
  const stage = REPORT_STAGES.includes(String(b.stage)) ? String(b.stage) : 'unknown';
  const id = reportId();

  // optional original document, stored under server/data/reports
  let filePath: string | null = null;
  let mime: string | null = null;
  if (typeof b.fileBase64 === 'string' && b.fileBase64.length > 0) {
    const declared = String(b.mime ?? '');
    const ext = REPORT_EXTENSIONS[declared];
    if (!ext) {
      res.status(400).json({ error: `Unsupported file type "${declared}". Use PDF, JPG, PNG or WebP.` });
      return;
    }
    const buffer = Buffer.from(b.fileBase64, 'base64');
    if (buffer.byteLength === 0) {
      res.status(400).json({ error: 'fileBase64 did not decode to any content' });
      return;
    }
    if (buffer.byteLength > MAX_REPORT_FILE_BYTES) {
      res.status(400).json({ error: 'File is larger than 25 MB' });
      return;
    }
    mkdirSync(REPORTS_DIR, { recursive: true });
    filePath = path.join(REPORTS_DIR, `${id}.${ext}`);
    writeFileSync(filePath, buffer);
    mime = declared;
  }

  const report = insertReport(id, {
    date: b.date as string,
    title: String(b.title ?? 'Clinical report').slice(0, 120),
    specialty: String(b.specialty ?? '').slice(0, 60),
    region,
    stage,
    stageSource: b.stageSource === 'user' ? 'user' : 'ai',
    stageRationale: String(b.stageRationale ?? '').slice(0, 400),
    summary: String(b.summary ?? '').slice(0, 4000),
    findings: Array.isArray(b.findings)
      ? (b.findings as unknown[]).map((f) => String(f).slice(0, 400)).slice(0, 8)
      : [],
    followUp: String(b.followUp ?? '').slice(0, 600),
    fileName: String(b.fileName ?? '').slice(0, 200),
    filePath,
    mime,
  });
  res.json(report);
});

/** User override of the AI proposal (stage, region, date, title). */
app.patch('/api/reports/:id', (req, res) => {
  const b = req.body ?? {};
  const patch: Record<string, string> = {};
  if (b.date !== undefined) {
    if (!isIsoDate(b.date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    patch.date = b.date as string;
  }
  if (b.region !== undefined) {
    if (!REPORT_REGIONS.includes(String(b.region))) {
      res.status(400).json({ error: 'unknown region' });
      return;
    }
    patch.region = String(b.region);
  }
  if (b.stage !== undefined) {
    if (!REPORT_STAGES.includes(String(b.stage))) {
      res.status(400).json({ error: 'unknown stage' });
      return;
    }
    patch.stage = String(b.stage);
    patch.stageSource = 'user'; // an explicit stage change is always a human decision
  }
  if (b.title !== undefined) patch.title = String(b.title).slice(0, 120);
  if (b.specialty !== undefined) patch.specialty = String(b.specialty).slice(0, 60);

  const updated = updateReport(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: 'report not found' });
    return;
  }
  res.json(updated);
});

app.get('/api/reports/:id/file', (req, res) => {
  const file = getReportFile(req.params.id);
  if (!file) {
    res.status(404).json({ error: 'no stored document for this report' });
    return;
  }
  // paths are generated server-side from the report id, so they cannot escape REPORTS_DIR
  res.type(file.mime ?? 'application/octet-stream');
  res.sendFile(file.filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'stored document is missing' });
  });
});

app.delete('/api/reports/:id', (req, res) => {
  const { deleted, filePath } = deleteReport(req.params.id);
  if (deleted && filePath) rmSync(filePath, { force: true });
  res.json({ ok: deleted });
});

// ---------- static frontend (production) ----------

const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const port = Number(process.env.PORT ?? 3101);
app.listen(port, () => {
  // the schema is created on first import of db.ts, so by now the file exists
  console.log(`[vitals-hub] API + static server → http://localhost:${port}`);
  console.log(`[vitals-hub] data directory     → ${DATA_DIR}`);
  console.log(
    isConfigured()
      ? '[vitals-hub] account ready — sign in to continue'
      : '[vitals-hub] first run: open the app and create the owner account',
  );
});
