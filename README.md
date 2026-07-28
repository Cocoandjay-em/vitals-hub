# Vitals Hub

A self-hosted dashboard for your own medical history: upload lab reports and
specialist visit reports, let an AI vision model read them, and watch every
biomarker trend on an interactive 3D anatomical scan.

Everything runs on your machine or your own server. Data lives in a local
SQLite file; nothing leaves the box except the pages you explicitly send to the
AI endpoint you configure — and with a local model (Ollama, LM Studio) not even
those.

> **Not a medical device.** It provides no diagnosis and no medical advice.
> Reference ranges differ between laboratories. Always discuss results with your
> doctor.

## What it does

- **Lab reports → biomarkers.** Drop in a PDF, JPG or PNG. An AI vision model
  extracts every analyte, its value, unit, printed reference range and H/L flag,
  and the collection date. Without an API key it falls back to a fully offline
  pipeline: PDF text layer, `tesseract.js` OCR, and a heuristic parser that
  understands English and Italian lab layouts. You review every row before it is
  saved.
- **Clinical reports → organs.** A neurology or cardiology letter has no
  numbers to trend. The AI reads it, proposes the visit date, the organ it
  concerns and a criticality stage with a rationale quoted from the document;
  after you confirm, it attaches to that organ on the body scan.
- **3D body scan.** Real Visible Human anatomy (HuBMAP CCF, CC BY 4.0). Each
  organ glows in the colour of its worst signal — an out-of-range marker or a
  staged report, whichever is more severe. Click an organ for its values, its
  reports and a plain-language AI explanation.
- **Trends and vitals.** Every marker is a time series. Weight, blood pressure,
  heart rate and temperature get their own cards, by manual entry or from an
  Apple Health export (parsed streaming in the browser, so a multi-hundred-MB
  export never sits in memory).

## Requirements

- **Node.js 20 or newer** (22 LTS recommended) and npm
- A C toolchain — `better-sqlite3` compiles a native module on install
  (`build-essential` on Debian/Ubuntu, Xcode command line tools on macOS)
- Optional: an API key for any OpenAI-compatible **vision** model

## Run it locally

```bash
git clone <your-fork-url> vitals-hub
cd vitals-hub
npm install
npm run dev
```

Open <http://localhost:3000>. Two processes start together: the Vite dev server
on port 3000 (proxying `/api`) and the Express backend on port 3101.

To pass Vite arguments through:

```bash
npm run dev -- --port 7100 --host
```

### What happens on first run

You do not create or migrate a database by hand. On the very first start the
backend creates `DATA_DIR` (default `server/data`), creates `biomarkers.db`,
and applies the whole schema — `tests`, `biomarkers`, `reports`, `users`,
`sessions`, `settings` — before the server accepts a request. Every later start
reuses the same file, and new tables are added with `CREATE TABLE IF NOT EXISTS`,
so upgrading is just pulling new code and restarting. The startup log tells you
exactly where the data went:

```
[vitals-hub] API + static server → http://localhost:3101
[vitals-hub] data directory     → /srv/vitals-hub/server/data
[vitals-hub] first run: open the app and create the owner account
```

The first page you see asks you to **create the owner account** — username,
password, and optionally your name, date of birth and which body model the 3D
scan should render. There is no default password: the account does not exist
until you make it, and once it does, `/api/auth/setup` refuses to run again.
Signing in issues a 30-day session.

## Using it

**Add a lab report.** Click **SCAN LAB**, drop in a PDF or photo, wait for the
rows to be extracted, check them, then **ADD TO HISTORY**. Nothing is stored
until you confirm. The test date is editable if it was misread, and rows with no
printed reference range are flagged so you can spot extraction gaps.

**Add a specialist report.** Click **CLINICAL REPORT** for a document with no lab
values — a neurology letter, a radiology report. The AI proposes the visit date,
the organ it belongs to and a criticality stage, quoting the wording that
justifies it. Adjust anything, then **ATTACH TO BODY MAP**. The organ lights up
in the stage colour, and the original document stays downloadable from the organ
card.

**Explore.** Click any organ on the scan for its markers, its reports and a
plain-language explanation. Click a marker for its trend over time. **RESULTS**
opens the full table with per-value explanations and **AI ANALYSIS** summarises
the whole panel.

**Track vitals.** **MANUAL +** records weight, blood pressure, heart rate or
temperature in one tap. **APPLE HEALTH** imports an iPhone Health export
(`export.zip`).

**Manage your account.** **ACCOUNT** holds your name, date of birth (the header
shows your age), the body model, and the password change form. **AI KEY** holds
the AI endpoint settings. Sign out from the badge in the bottom-right corner.

**Track more than one person.** One login can hold a partner or a child
alongside you. Add them under **ACCOUNT → People**, then use the switcher beside
the header to change who the dashboard is showing — tests, reports, vitals and
the body model all follow that person. The switcher only appears once a second
person exists, so a single-person install looks exactly as it did before.

Everyone on the account is visible to anyone who can sign in: this separates
*people*, not *privacy*. If two adults each want data the other cannot see, run
two installations. The choice of person lives on the session, so a phone and a
laptop can show different people at the same time. Removing a person
permanently deletes their tests, markers and stored documents, and the last
person cannot be removed.

## Run it as a single process

```bash
npm run build    # type-check + production bundle into dist/
npm start        # Express serves the API and the built frontend on :3101
```

That is the whole production setup: one Node process, one SQLite file.

## Deploy on a server

Any Linux box with Node 20+ works, including the smallest cloud instances. The
example below is Ubuntu with Caddy for automatic HTTPS; nginx works just as
well.

**1. Build.** Building needs more memory than a small instance has, so build
locally and copy the result up, or build on the server if it has ≥1 GB RAM.

```bash
npm ci && npm run build
rsync -az --exclude node_modules --exclude .git --exclude server/data \
  ./ user@your-server:/srv/vitals-hub/
```

**2. Install dependencies on the server.**

```bash
sudo apt-get install -y nodejs build-essential
cd /srv/vitals-hub && npm ci --omit=dev
```

**3. Run it as a service.** Create `/etc/systemd/system/vitals-hub.service`:

```ini
[Unit]
Description=Vitals Hub
After=network.target

[Service]
User=vitals
WorkingDirectory=/srv/vitals-hub
ExecStart=/usr/bin/npm start
Environment=NODE_ENV=production
Environment=PORT=3101
Environment=DATA_DIR=/var/lib/vitals-hub
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now vitals-hub
```

**4. Terminate TLS in front of it.** A `Caddyfile` this short is enough —
Caddy obtains and renews the certificate itself:

```caddy
vitals.example.com {
	reverse_proxy localhost:3101
}
```

Point an `A` record at the server first, then reload Caddy. Visit the domain and
create your account.

The app trusts one proxy hop (`X-Forwarded-Proto`, `X-Forwarded-For`) so that
session cookies are marked `Secure` over HTTPS and login throttling sees real
client addresses. If you put it behind more than one proxy, adjust
`app.set('trust proxy', …)` in `server/src/index.ts`.

## Configuration

Copy `server/.env.example` to `server/.env`. Every value is optional; AI
settings can also be entered in the UI, which stores them in the database.
Environment variables win over stored settings.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3101` | port the backend listens on |
| `DATA_DIR` | `server/data` | where `biomarkers.db` and stored documents live |
| `AI_API_KEY` | — | key for an OpenAI-compatible endpoint |
| `AI_BASE_URL` | `https://api.openai.com/v1` | e.g. `http://localhost:11434/v1` for Ollama |
| `AI_MODEL` | `gpt-5.6-luna` | must be **vision-capable** for report extraction |

`server/.env` and `server/data/` are gitignored. Never commit either — the
database holds your health records and your API key.

## Backups

Everything is in one directory (`DATA_DIR`): the SQLite database and the
original report documents. Because SQLite runs in WAL mode, copy it with the
`.backup` command rather than `cp`, which can capture a torn file:

```bash
sqlite3 /var/lib/vitals-hub/biomarkers.db ".backup '/backup/vitals-$(date +%F).db'"
```

There is also **EXPORT** in the app, which downloads the full history as JSON
and can be imported into another instance.

## Security

- Passwords are hashed with **scrypt** and a per-user random salt; the plaintext
  is never stored or logged.
- Session tokens are 256 bits of CSPRNG output. Only their SHA-256 digest is
  stored, so a leaked database cannot be replayed as a live session.
- The session cookie is `HttpOnly` (invisible to JavaScript), `SameSite=Lax`
  (not sent on cross-site POSTs, which blocks CSRF) and `Secure` over HTTPS.
- Failed logins are throttled per IP; the error never reveals whether a username
  exists, and unknown users cost the same time as known ones.
- Changing your password invalidates every existing session.
- Every `/api` route requires a session except `/api/health` and the auth
  endpoints.

This is a single-account personal deployment. It has no password reset and no
multi-user sharing. Change your password under **ACCOUNT** while signed in. If
you are ever locked out, clear the account and start the first-run flow again —
your health data is untouched:

```bash
sqlite3 "$DATA_DIR/biomarkers.db" "DELETE FROM sessions; DELETE FROM users;"
```

## AI setup

Sign in, click **AI KEY**, and provide an API key, a base URL and a
vision-capable model. **TEST CONNECTION** verifies it against the provider. The
key is stored in your SQLite database, is never returned by the API, and is only
ever sent to the endpoint you configured.

Works with any OpenAI-compatible endpoint: OpenAI, Moonshot/Kimi, OpenRouter,
Ollama, LM Studio. Pick a local model if reports must never leave the machine.

Without a key the app still works: lab extraction falls back to OCR and the
offline parser. Clinical report staging is the one feature that genuinely needs
a model.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite + Express together, with hot reload |
| `npm run dev:server` | backend only, on :3101 |
| `npm run build` | type-check and build to `dist/` |
| `npm start` | single-process production server |
| `npm run lint` | ESLint over the whole repo |
| `npm run preview` | Vite's static preview of `dist/` (no API) |

Parser and PDF smoke tests:

```bash
npx esbuild scripts/test-parser.ts --bundle --format=esm --platform=node "--alias:@=./src" --outfile=/tmp/test-parser.mjs && node /tmp/test-parser.mjs
```

```bash
npx esbuild scripts/test-pdf.ts --bundle --format=esm --platform=node "--alias:@=./src" --outfile=/tmp/test-pdf.mjs && node /tmp/test-pdf.mjs
```

## Backend API

All under `/api`, JSON. Everything except `/api/health` and `/api/auth/*`
requires a session cookie.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | liveness probe |
| `GET /api/auth/status` | `{configured, authenticated, username}` |
| `POST /api/auth/setup` | first run only: create the owner account |
| `POST /api/auth/login` / `logout` | start / end a session |
| `POST /api/auth/password` | change password (revokes all sessions) |
| `GET /api/history` | all tests + biomarkers |
| `POST /api/tests` | create or merge a test by date |
| `DELETE /api/markers/:id` · `/api/tests/:id` · `/api/history` | delete one marker, one test, or everything |
| `GET` / `PUT /api/profile` | name, date of birth and body model |
| `GET` / `PUT /api/config` | AI settings (the key is never returned) |
| `GET /api/config/test` | connectivity check against the provider |
| `POST /api/extract` | vision extraction of lab pages |
| `POST /api/explain` · `/api/explain-marker` · `/api/analysis` | AI explanations for an organ, one value, or a full panel |
| `POST /api/import/apple-health` | bulk import of Apple Health records |
| `GET /api/reports` | all clinical reports, newest visit first |
| `POST /api/reports/analyze` | stage a clinical report (returns a proposal, saves nothing) |
| `POST /api/reports` | store a confirmed report |
| `PATCH /api/reports/:id` | override stage / region / date / title |
| `GET /api/reports/:id/file` | download the stored original |
| `DELETE /api/reports/:id` | delete a report and its file |

## How the pieces fit

```
src/            React 19 + Vite frontend
  components/   HUD widgets, 3D scan, review cards, auth gate
  lib/          API client, regions, extraction, parser, Apple Health
server/src/     Express: index.ts (routes), db.ts (SQLite), ai.ts, auth.ts
public/models/  Visible Human anatomy (.glb)
```

Storage is `better-sqlite3` in WAL mode: `tests` 1—N `biomarkers`, plus
`reports`, `users`, `sessions` and a `settings` key/value table.

Extraction detail worth knowing: PDF pages are rasterised in the browser with
`pdfjs-dist` before being sent to the model, and the offline parser reconstructs
visual lines from text-item coordinates so multi-column lab tables parse
correctly. It understands `lo-hi`, `<hi`, `>lo`, bracketed and labelled ranges,
decimal commas, both thousands separators, printed flag words, and a ~90-name
marker dictionary with English and Italian aliases. Ambiguous numeric dates are
read day-first.

## Help wanted: the body shapes

**The 3D bodies are still a work in progress and I would be glad of help.**

The anatomy comes from real cadaver scans, so each body carries its donor's
build and the organs were authored against a different scan than the skin.
`scripts/reshape-anatomy.mjs` currently corrects this with maths — a vertical
narrowing profile over the torso, organs rescaled to adult reference dimensions
and slid into their anatomical band, and the same profile applied to the viscera
so nothing pokes through the abdominal wall. It is measurably better, but
sculpting a cadaver mesh with a cosine profile has a ceiling.

Ideas, pull requests and better meshes are all welcome:

- Swapping the skin shell for a well-proportioned CC0 base mesh (Blender
  Studio's Human Base Meshes, MakeHuman) while keeping the real organs inside.
- A proper morph-target rig instead of the current per-vertex profile, so body
  shape could follow the user's own height and weight.
- Better bust and hip shaping — the current version is a radial dome, which is
  crude.
- More organs: thyroid, pancreas, spleen, bladder, and a real diaphragm.

Open an issue or a PR — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the
checks a PR has to pass, and the gotchas around regenerating the meshes (the
body pass is not idempotent, so start from pristine meshes).

## Limitations

- Extraction quality depends on the model and the scan. Always review the parsed
  rows — that is why nothing is saved until you confirm.
- The offline parser is heuristic; exotic layouts may need manual cleanup.
- A criticality stage reflects only what a report already states. It is not a
  diagnosis, and you can always override it.
- Single account, no password reset flow, no sharing.

## Credits and licence

Anatomical models from the [HuBMAP CCF 3D Reference Object Library](https://humanatlas.io/)
(CC BY 4.0). **Modified**: the meshes derive from real cadaver scans, so each
body carried its donor's build and the organs — coming from separate scans —
were not in proportion with the body around them. `scripts/reshape-anatomy.mjs`
narrows the torso along an anatomical profile and rescales each organ to an
adult reference dimension about its own centre; `scripts/resize-lungs.mjs`
re-inflates the collapsed donor lungs. Both are re-runnable and documented.

Released under the MIT licence — see [LICENSE](LICENSE).
