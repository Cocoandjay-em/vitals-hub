# Vitals HUD — Blood Biomarker Dashboard

A local-first, futuristic medical HUD for tracking blood-test biomarkers over time.
Upload lab reports (PDF / JPG / PNG), extract biomarker rows with an AI vision model
(or fully offline with OCR + a heuristic parser), confirm them, and watch trends on a
sci-fi style dashboard. Data lives in a local SQLite database via a small Express
backend — no accounts, nothing leaves your machine except the pages you explicitly
send to your configured AI endpoint.

## Run in development

```bash
npm install
npm run dev
```

This starts both processes at once:

- **web** — Vite dev server on port 3000 (proxies `/api` to the backend)
- **server** — Express backend on port 3101 (`tsx watch`, auto-restarts)

Vite CLI args are forwarded, so a custom port/host works:

```bash
npm run dev -- --port 7100 --host
```

## AI extraction setup (optional but recommended)

Open the app, click **AI** in the Test History panel header, and enter:

- **API key** — for any OpenAI-compatible vision endpoint (OpenAI, Moonshot/Kimi,
  OpenRouter, Ollama, LM Studio…)
- **Base URL** — e.g. `https://api.openai.com/v1`, `https://api.moonshot.ai/v1`,
  `http://localhost:11434/v1` (Ollama)
- **Vision model** — e.g. `gpt-4o-mini`, `moonshot-v1-32k-vision-preview`, `llava`

**TEST CONNECTION** verifies the key against the provider. The key is stored only
in the local SQLite database (`server/data/biomarkers.db`) and is never returned by
the API or sent anywhere except the configured endpoint. Alternatively, copy
`server/.env.example` to `server/.env` and set `AI_API_KEY` / `AI_BASE_URL` /
`AI_MODEL` there — environment variables take precedence over stored settings.

Without a key, extraction falls back to the fully offline pipeline
(PDF text layer + `tesseract.js` OCR + heuristic parser).

## Build & run as a single process

```bash
npm run build    # tsc -b && vite build -> dist/
npm start        # Express serves the API *and* the built frontend on :3101
```

Deploy by copying the repo (or `dist/` + `server/` + `node_modules`) to any Node
host and running `npm start`; set `PORT` to change the listen port.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite (web) + Express (API) together, with hot reload |
| `npm run dev:server` | Backend only, on :3101 |
| `npm run build` | Type-check + production build to `dist/` |
| `npm start` | Single-process production server (API + static frontend) |
| `npm run preview` | Vite's static preview of `dist/` (no API) |

## Backend API

All under `/api` (JSON):

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | liveness probe |
| `GET /api/history` | all tests + biomarkers (flat, joined client-side) |
| `POST /api/tests` | create/merge a test by date; same-name markers upsert |
| `DELETE /api/markers/:id` | delete one marker (empty parent test is dropped) |
| `DELETE /api/tests/:id` | delete a whole test record |
| `DELETE /api/history` | wipe everything |
| `GET /api/config` | AI settings (never includes the key, only `hasKey`) |
| `PUT /api/config` | update `baseUrl` / `model` / `apiKey` (empty clears) |
| `GET /api/config/test` | connectivity check against the provider |
| `POST /api/extract` | vision extraction: `{pages:[{name, imageBase64, mime}]}` |
| `POST /api/explain` | plain-language organ insight: `{region, markers:[{name, value, unit, refLow, refHigh, flag}], date?}` → `{explanation}` |
| `POST /api/explain-marker` | single-value meaning: `{name, value, unit, refLow, refHigh, flag, category?}` → `{explanation}` (2–3 sentences) |
| `POST /api/analysis` | general panel assessment: `{date?, markers:[{name, value, unit, refLow, refHigh, flag, category}]}` → `{analysis}` (paragraph + `- ` bullets) |
| `POST /api/import/apple-health` | Apple Health records: `{records:[{type, date, value, unit}]}` → `{imported, days, skipped}` |

Storage: `better-sqlite3` at `server/data/biomarkers.db` (WAL mode, foreign keys,
`tests` 1—N `biomarkers`, `settings` key/value). Legacy `localStorage` history is
detected on first load with an import/discard banner.

## How it works

- **Layout** — on desktop (`lg+`) the app fills the viewport (`100dvh`): the
  header spans the full width, the body map sits in a fixed left column
  (~34%, hologram scales to the available height) and everything else lives in
  an independently scrolling right column. Below `lg` it falls back to a normal
  stacked single-column flow.
- **Upload** — drag & drop or file picker, multiple files at once.
- **Body map** — a holographic human-body HUD panel (reticle rings, scanline
  sweep, breathing float; all animations honour `prefers-reduced-motion`). Each
  organ system lights up **in the shape of the organ itself**: layered
  radial-gradient glow ellipses (`mix-blend-mode: screen`, blurred, slowly
  breathing) tinted by the region's worst flag — rose for high, amber for low,
  emerald for normal, cyan for unknown — with glow brightness scaled by how far
  the worst value sits beyond its reference bound (capped, subtle). Regions
  (centres measured at full resolution against the hologram): Thyroid/Hormones
  → thyroid band at the base of the neck (50, 19.5), Lipids → heart (50, 27.5),
  Inflammation → both lungs (43/57, 28.5) with the dot at the carina,
  Liver → wide ellipse on the upper-right abdomen (44.5, 36, viewer's left),
  Metabolic/Glucose → gut blob (50.5, 39.5), Kidney → two flank glows
  (45/54.5, 37.5), CBC/Vitamins/Other → **systemic**: instead of a body wash,
  six elongated capsule streaks follow the visible **vasculature** (thoracic +
  abdominal aorta, both inner arms, both thigh→shin bundles) with staggered
  pulse delays that read as flowing blood; its chip anchors at the inner
  forearm veins (24, 52). The small pulsing dot + label chip remains as the
  click anchor on each glowing organ.
- **Zoom-to-organ** — clicking an organ smoothly **zooms the hologram toward
  it** (translate+scale on a wrapper, ~540 ms ease, organ lands centred; ×2 on
  desktop, ×1.4 on mobile) while the reticles fade and a **floating info card**
  anchors next to the organ with a dashed connector line to its dot. The card
  lists the region's markers with values/flags (each clickable → trend) plus a
  plain-language AI explanation from `POST /api/explain` (text-only call; only
  `model` + `messages` are sent so strict models are tolerated; same
  retry/backoff as extraction). The prompt asks for 3–5 lay sentences — what
  each flagged marker measures, what high/low commonly suggests — and forbids
  diagnosing or inventing values. Explanations are cached in memory +
  `localStorage` keyed by region + marker-value hash (re-clicks are instant and
  burn no tokens). Without an API key the card shows an offline fallback:
  a static description of the organ system plus the marker values. Clicking the
  same organ again, pressing ESC, clicking the backdrop or the close button
  zooms back out; clicking a different organ animates straight to it. On mobile
  the card docks below the hologram. `prefers-reduced-motion` makes the zoom an
  instant jump.
- **Per-marker AI meaning** — every row in the results table has an ⓘ button
  that expands an inline mini-card with a 2–3 sentence explanation from
  `POST /api/explain-marker`: what the marker measures and what *this* value
  means given its range. Cached per name+value+flag; row click → trend is
  unchanged.
- **AI panel analysis** — the **AI ANALYSIS** button in the Latest Results
  panel header sends the full viewed panel to `POST /api/analysis` and shows a
  HUD card above the results table: one short overall paragraph, then 3–6
  bullets grouped by theme (lipids, liver, glucose…) covering what looks good
  and what deserves attention, with calm lifestyle/doctor framing — never a
  diagnosis, never invented values. Cached like the organ explanations (memory
  + `localStorage` keyed by date + marker hash). Without an API key the card
  offers a shortcut to the AI settings; with no markers the button is disabled.
- **Apple Health import** — the **APPLE HEALTH** button in the Intake panel
  accepts an iPhone Health export (`export.zip` or the `export.xml` inside it;
  Health app → profile picture → Export All Health Data). The file is parsed
  **streaming** in the browser with `fflate` (the zip is inflated chunk by
  chunk and the XML scanned incrementally — exports of hundreds of MB never
  sit in memory whole). Only blood pressure (systolic/diastolic), heart rate,
  body mass and body temperature records are extracted and posted to
  `POST /api/import/apple-health` in batches of 500; the backend maps them to
  the same markers as manual entry (with the same reference ranges and computed
  flags), merged by date with source *Apple Health*. Progress (MB scanned,
  records found/imported) and a completion summary are shown in the UI.
  **Note:** pushing data *to* Apple Health is not possible from a web app —
  that requires a native iOS app with HealthKit.
- **Extraction — AI mode (key configured)**: each PDF page is rasterised to JPEG
  in the browser (`pdfjs-dist`, ~1.75×) and sent to `POST /api/extract`; the
  backend calls the configured OpenAI-compatible chat-completions endpoint with
  a strict-JSON prompt (collection date — never DOB/print date, exact values,
  printed reference ranges and H/L flags preserved, fixed category taxonomy),
  validates and merges the per-page results into one result per file.
- **Extraction — offline mode (no key)**
  - PDFs: text layer via `pdfjs-dist` (legacy build). Text items are regrouped
    into visual lines by their Y coordinate (and ordered by X within a line) so
    tabular reports parse correctly. Pages without a text layer are rasterised
    and OCR'd.
  - Images / scanned pages: OCR via `tesseract.js` (English model, runs in a
    Web Worker; first run downloads the model, which is then cached).
- **Parsing (offline mode)** — a heuristic line parser (`src/lib/parser.ts`) recognises rows like
  `Hemoglobin 13.5 g/dL 12.0 - 15.5`, `WBC 6.5 10*9/L (4.0-10.0)`,
  `Cholesterol, Total 210 mg/dL <200`, `Emoglobina 13,5 g/dL 12,0-15,5`.
  It understands `lo-hi`, `lo - hi`, `lo/hi`, `lo÷hi`, `<hi`, `>lo`, `(lo-hi)`,
  `[lo-hi]` ranges, ranges followed by a method/comment tail
  (`4-11 Impedance`, `80.0-100.0 Derived from RBC`), ranges followed by a
  repeated unit (`12.0-15.5 g/dL`), **labeled classification ranges**
  (`Desirable: <5.18`, `Normal:4.0-5.6`, `Optimal 30 - 100`) including
  multi-line classification blocks (continuation bands are attached to the
  analyte above; a band labeled *Normal/Optimal/Desirable* overrides the first
  band), printed **flag words** after the value (`High`/`Low`/`H`/`L`, which
  take precedence over the computed flag), leading row indices/markers
  (`3 White Cell Count …`, `# AST …`), decimal commas (`13,5`), both
  thousands-separator styles (`1,234.5` / `1.234,5`), Italian range phrases
  (`fino a 200`, `inferiore a 5`, `superiore a 40`, `da 12 a 15,5`), a
  ~90-name known-marker dictionary with English **and Italian** aliases
  (Emoglobina, Glicemia, Colesterolo totale/HDL/LDL, Trigliceridi, Creatinina,
  Transaminasi ALT/GPT, Piastrine, Ferritina, Azotemia, PCR, VES…), and
  keyword-based categorisation (CBC, Lipids, Metabolic, Liver, Kidney, Thyroid,
  Vitamins, Hormones, Inflammation, Glucose, Other).
  A line that contains **only** a range (common in multi-column PDFs where the
  range column becomes its own text line) is attached to the nearest previous
  biomarker row that still lacks one. Differential percentages
  (`Neutrophils %`) are kept alongside absolute counts.
  Test dates are detected from common formats (English + Italian month names)
  near keywords such as *collection date / date / collected / reported / data /
  prelievo / referto* — an explicit *Collection Date* line wins; date-of-birth
  lines are never used; ambiguous numeric dates are interpreted **day-first**
  (DD/MM/YYYY). Fallback: today.
- **Review & confirm** — each file shows a parsed-rows summary with flags, the
  extraction method (AI vision vs offline), an **editable test date** (correct
  wrong detections before confirming); rows without a reference range get an
  explicit amber **NO RANGE** chip (and a per-file "N WITHOUT RANGE" counter) so
  you can spot extraction gaps. Raw extracted text is available in a
  collapsible. Rows only enter history after you click **ADD TO HISTORY**.
- **Manual entry (quick-add)** — the **MANUAL +** button in the Intake panel
  opens a one-tap flow: preset chips (WEIGHT kg, BLOOD PRESSURE mmHg,
  HEART RATE bpm, TEMPERATURE °C) show only the value field(s) — blood pressure
  gets two side-by-side fields (systolic/diastolic, saved as two markers) —
  plus a datetime field prefilled with right now. Reference ranges are applied
  automatically in the background (BP 90–120 / 60–80 mmHg, HR 60–100 bpm,
  Temp 36.1–37.2 °C, Weight none); free-text name, custom unit and custom
  ranges live behind an **Advanced** toggle. One-click save with a flash
  confirmation; re-saving the same name on the same date overwrites, and any
  row can be deleted from the results table (hover ✕). Saved with source
  *Manual entry*, merged with any existing record for that date.
- **History** — persisted in the SQLite database via the API, merged by test
  date (newer values for the same marker win). JSON export/import included,
  plus **DEMO** seed data (3 sample tests, clearly labelled) and **CLEAR**.

## Tests

`scripts/` contains Node-based smoke tests for the parser and the PDF pipeline:

```bash
npx esbuild scripts/test-parser.ts --bundle --format=esm --platform=node "--alias:@=./src" --outfile=/tmp/test-parser.mjs && node /tmp/test-parser.mjs
npx esbuild scripts/test-pdf.ts --bundle --format=esm --platform=node "--alias:@=./src" --outfile=/tmp/test-pdf.mjs && node /tmp/test-pdf.mjs
```

## Limitations

- AI extraction quality depends on the chosen vision model; always review the
  parsed rows before confirming. Pages are sent to your configured endpoint —
  pick a local model (Ollama/LM Studio) if reports must not leave the machine.
- OCR accuracy depends on scan quality; skewed, low-resolution or handwritten
  reports may produce partial or noisy rows — always review before confirming.
- The offline parser is heuristic: exotic report layouts (multi-column results
  per row, values embedded in prose) may need manual cleanup. Unknown markers
  are kept when they carry a reference range, otherwise dropped to reduce noise.
- Date detection prefers lines containing date keywords; ambiguous numeric dates
  (`03/04/2025`) are interpreted **day-first** (Italian convention).
- A single-separator number like `1.234` is read as a decimal (1.234), not
  Italian thousands — ambiguous by nature. Mixed forms (`1.234,5`, `1,234.5`)
  are resolved correctly.
- Reference ranges come from your report and may differ between labs; this app
  is not a medical device and provides no diagnostic advice.
