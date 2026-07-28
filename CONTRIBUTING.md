# Contributing

Thanks for looking. This is a personal health dashboard I use daily, so the bar
is "does it stay correct and simple", not "does it have every feature".

## Getting set up

```bash
npm install
npm run dev
```

The first screen asks you to create an account — there is no seed user. Use
**DEMO** in the results drawer to get sample data without uploading anything
real. Never commit real reports or a database; `server/data/` and `server/.env`
are gitignored for that reason.

## Before you open a pull request

```bash
npm run lint
```

```bash
npm run build
```

Both must be clean. Plus the parser and PDF smoke tests when you touch
extraction:

```bash
npx esbuild scripts/test-parser.ts --bundle --format=esm --platform=node "--alias:@=./src" --outfile=/tmp/t.mjs && node /tmp/t.mjs
```

If a linter rule is in your way, fix the code rather than the config — the
ESLint config is deliberately strict and the repo currently passes it cleanly.

## Where help is most wanted

**The 3D body shapes.** The anatomy comes from real cadaver scans (HuBMAP CCF),
so each body carries its donor's build, and the organs were authored against a
different scan than the skin. `scripts/reshape-anatomy.mjs` corrects this with
maths — a vertical narrowing profile over the torso, organs rescaled to adult
reference dimensions and slid into their anatomical band, then the same profile
applied to the viscera so nothing pokes through the abdominal wall. It is
measurably better, but sculpting a cadaver mesh with a cosine profile has a
ceiling. Ideas welcome:

- swap the skin shell for a well-proportioned CC0 base mesh (Blender Studio's
  Human Base Meshes, MakeHuman) while keeping the real organs inside
- a morph-target rig instead of the per-vertex profile, so shape could follow
  the person's own height and weight
- better bust and hip shaping — the current version is a radial dome, which is crude
- more organs: thyroid, pancreas, spleen, bladder, a real diaphragm

**If you change the meshes:** run `node scripts/reshape-anatomy.mjs --dry` and
put the before/after numbers in the PR. The body pass is **not idempotent** —
start from pristine meshes (`git checkout public/models`) or you will narrow it
twice. Organ placement targets absolute positions, so that part is safe to
re-run.

Other useful work: lab layouts the parser mishandles (attach a redacted sample),
code-splitting the ~1.9 MB bundle, and reference ranges that differ by lab.

## House style

- Comments explain *why*, not *what*. If the code needs a comment to say what it
  does, the code probably needs changing instead.
- Keep the medical framing honest: this app never diagnoses. A criticality stage
  reflects only what a report already states, and the user can always override it.
- Health data belongs to a *subject*, not to the account. Any new query touching
  tests, biomarkers or reports must be scoped by `subject_id`.

## Reporting a problem

Open an issue with the steps, what you expected, and what happened. For
extraction bugs a redacted sample PDF helps enormously — **redact it properly**,
never attach a real report with identifiers intact.
