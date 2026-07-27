/**
 * Vitals HUD — backend entrypoint.
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

import express from 'express';
import {
  clearHistory,
  deleteMarker,
  deleteTest,
  getHistory,
  getSetting,
  setSetting,
  upsertTest,
} from './db.js';
import {
  analyzePanel,
  explainMarker,
  explainRegion,
  extractWithAI,
  publicConfig,
  testConnection,
  updateConfig,
} from './ai.js';

const app = express();
app.use(express.json({ limit: '60mb' })); // rasterized PDF pages are chunky

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

// ----- user profile (body model sex, stored in the settings table) -----

type ProfileSex = 'male' | 'female';
const PROFILE_DEFAULT: ProfileSex = 'male'; // owner profile: man

function readProfile(): { sex: ProfileSex } {
  const raw = getSetting('profile_sex');
  return { sex: raw === 'female' ? 'female' : PROFILE_DEFAULT };
}

app.get('/api/profile', (_req, res) => {
  res.json(readProfile());
});

app.put('/api/profile', (req, res) => {
  const b = req.body ?? {};
  if (b.sex !== undefined && b.sex !== 'male' && b.sex !== 'female') {
    res.status(400).json({ error: "sex must be 'male' or 'female'" });
    return;
  }
  if (b.sex !== undefined) setSetting('profile_sex', b.sex);
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

// ---------- static frontend (production) ----------

const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const port = Number(process.env.PORT ?? 3101);
app.listen(port, () => {
  console.log(`[vitals-hud] API + static server → http://localhost:${port}`);
});
