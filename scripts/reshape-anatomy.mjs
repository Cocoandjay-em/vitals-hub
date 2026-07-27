/**
 * Reshape the Visible Human anatomy so it reads as a healthy adult body.
 *
 * The source meshes (HuBMAP CCF, CC BY 4.0) come from real cadaver scans, which
 * creates two problems:
 *
 *   1. Each body carries its donor's build — the male donor was heavyset, the
 *      female donor a stocky 59-year-old — so neither silhouette reads as a
 *      healthy adult.
 *   2. The organs come from separate scans and are neither sized nor positioned
 *      consistently with the body around them. Measured against standard
 *      anthropometric landmarks (fractions of stature from the feet), the
 *      intestines topped out at 0.70 of stature when the small bowel should not
 *      pass 0.62, and the lungs reached 0.88 — apex level with the chin. The
 *      abdominal contents were crowding the chest.
 *
 * Three passes, all purely geometric:
 *
 *   BODY    — narrows the torso along a vertical profile, with an optional
 *             chest shaping pass. Sideways narrowing fades out past the torso
 *             so the arms are never dragged inward. NOT idempotent: re-running
 *             narrows twice, so revert the mesh first (git checkout).
 *   SIZE    — uniformly rescales an organ about its own centre until its
 *             longest axis matches an adult reference dimension.
 *   PLACE   — slides an organ vertically so its centre sits at the anatomical
 *             height for that organ. Idempotent: the target is absolute.
 *
 * Usage:
 *   node scripts/reshape-anatomy.mjs                 organs only (safe to repeat)
 *   node scripts/reshape-anatomy.mjs --body=female   also reshape that body
 *   node scripts/reshape-anatomy.mjs --dry           report, write nothing
 *
 * Undo: git checkout public/models
 */
import { NodeIO } from '@gltf-transform/core'

const DRY = process.argv.includes('--dry')
const BODY_ARG = process.argv.find((a) => a.startsWith('--body='))
const BODIES = BODY_ARG ? BODY_ARG.split('=')[1].split(',').filter(Boolean) : []
const io = new NodeIO()

/**
 * Recompute vertex normals in place, keeping the index buffer intact.
 * gltf-transform's normals() transform de-indexes the mesh, which turned a
 * 2.3 MB body into 11 MB — unacceptable for something loaded over the network.
 */
function recomputeNormals(prim) {
  const pos = prim.getAttribute('POSITION')
  const nrm = prim.getAttribute('NORMAL')
  if (!pos || !nrm) return
  const p = pos.getArray()
  const n = new Float32Array(p.length)
  const idx = prim.getIndices()
  const indices = idx ? idx.getArray() : null
  const corners = indices ? indices.length : p.length / 3

  for (let t = 0; t < corners; t += 3) {
    const a = (indices ? indices[t] : t) * 3
    const b = (indices ? indices[t + 1] : t + 1) * 3
    const c = (indices ? indices[t + 2] : t + 2) * 3
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2]
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2]
    const fx = e1y * e2z - e1z * e2y
    const fy = e1z * e2x - e1x * e2z
    const fz = e1x * e2y - e1y * e2x
    for (const v of [a, b, c]) {
      n[v] += fx
      n[v + 1] += fy
      n[v + 2] += fz
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= len
    n[i + 1] /= len
    n[i + 2] /= len
  }
  nrm.setArray(n)
}

/** Every POSITION accessor in a document, plus the overall bounding box. */
async function loadGeometry(path) {
  const doc = await io.read(path)
  const prims = []
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      prims.push(prim)
      const mn = pos.getMinNormalized([])
      const mx = pos.getMaxNormalized([])
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], mn[i])
        max[i] = Math.max(max[i], mx[i])
      }
    }
  return { doc, prims, min, max }
}

/* ------------------------------ body shape ------------------------------ */

/**
 * Control points down the body: y is 0 at the feet, 1 at the crown.
 * sx narrows left-right, sz narrows front-to-back; eased between points.
 */
const BODY_PROFILE = {
  male: [
    { y: 0.0, sx: 1.0, sz: 1.0 },
    { y: 0.08, sx: 0.97, sz: 0.95 },
    { y: 0.28, sx: 0.93, sz: 0.91 },
    { y: 0.46, sx: 0.9, sz: 0.86 },
    { y: 0.54, sx: 0.92, sz: 0.88 },
    { y: 0.62, sx: 0.86, sz: 0.86 }, // depth kept: the bowel has to fit
    { y: 0.7, sx: 0.92, sz: 0.88 },
    { y: 0.78, sx: 0.99, sz: 0.88 },
    { y: 0.86, sx: 0.97, sz: 0.92 },
    { y: 0.93, sx: 1.0, sz: 1.0 },
    { y: 1.0, sx: 1.0, sz: 1.0 },
  ],
  // hourglass: wide hips, tight waist, flat stomach, narrow shoulders
  female: [
    { y: 0.0, sx: 1.0, sz: 1.0 },
    { y: 0.08, sx: 0.95, sz: 0.93 },
    { y: 0.28, sx: 0.85, sz: 0.85 }, // calves
    { y: 0.44, sx: 0.8, sz: 0.79 }, // thighs slimmed so the hips read as hips
    { y: 0.53, sx: 0.97, sz: 0.9 }, // hips: widest point below the waist
    { y: 0.62, sx: 0.72, sz: 0.85 }, // waist: narrow from the front, but the
    { y: 0.68, sx: 0.79, sz: 0.86 }, // abdomen keeps the depth the bowel needs
    { y: 0.74, sx: 0.88, sz: 0.88 }, // bust line
    { y: 0.8, sx: 0.87, sz: 0.85 }, // shoulders stay narrow
    { y: 0.86, sx: 0.9, sz: 0.9 },
    { y: 0.93, sx: 1.0, sz: 1.0 },
    { y: 1.0, sx: 1.0, sz: 1.0 },
  ],
}

/**
 * Optional chest shaping, applied after the profile: pushes the front of the
 * chest forward around two centres with a smooth radial falloff, so the bust
 * is full and round rather than the flat cadaver silhouette.
 */
const BUST = {
  female: { t: 0.748, offsetX: 0.07, radius: 0.108, push: 0.03, lift: 0.006 },
}

function sampleProfile(profile, t) {
  if (t <= profile[0].y) return profile[0]
  const last = profile[profile.length - 1]
  if (t >= last.y) return last
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]
    const b = profile[i + 1]
    if (t >= a.y && t <= b.y) {
      const k = (t - a.y) / (b.y - a.y)
      const s = 0.5 - 0.5 * Math.cos(Math.PI * k)
      return { sx: a.sx + (b.sx - a.sx) * s, sz: a.sz + (b.sz - a.sz) * s }
    }
  }
  return last
}

/** Full sideways narrowing across the torso, none by the time we reach an arm. */
function torsoFalloff(dx, torsoHalf, armStart) {
  const d = Math.abs(dx)
  if (d <= torsoHalf) return 1
  if (d >= armStart) return 0
  const k = (d - torsoHalf) / (armStart - torsoHalf)
  return 0.5 + 0.5 * Math.cos(Math.PI * k)
}

async function reshapeBody(path, sex) {
  const { doc, prims, min, max } = await loadGeometry(path)
  const profile = BODY_PROFILE[sex]
  const bust = BUST[sex]

  const height = max[1] - min[1]
  const cx = (min[0] + max[0]) / 2
  const cz = (min[2] + max[2]) / 2
  // arms hang at an angle: the torso is about a third of the X extent
  const halfSpan = (max[0] - min[0]) / 2
  const torsoHalf = halfSpan * 0.34
  const armStart = halfSpan * 0.56

  const bustY = bust ? min[1] + bust.t * height : 0

  let count = 0
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION')
    const arr = pos.getArray()
    for (let i = 0; i < arr.length; i += 3) {
      const t = (arr[i + 1] - min[1]) / height
      const { sx, sz } = sampleProfile(profile, t)
      const dx = arr[i] - cx
      const w = torsoFalloff(dx, torsoHalf, armStart)
      let x = cx + dx * (1 + (sx - 1) * w)
      let y = arr[i + 1]
      let z = cz + (arr[i + 2] - cz) * sz

      if (bust && z > cz) {
        // distance to the nearer of the two centres, in the frontal plane
        const d = Math.min(
          Math.hypot(x - (cx - bust.offsetX), y - bustY),
          Math.hypot(x - (cx + bust.offsetX), y - bustY),
        )
        if (d < bust.radius) {
          const f = 0.5 + 0.5 * Math.cos((Math.PI * d) / bust.radius)
          z += bust.push * f
          y += bust.lift * f // sits high rather than sagging
        }
      }

      arr[i] = x
      arr[i + 1] = y
      arr[i + 2] = z
      count++
    }
    pos.setArray(arr)
    recomputeNormals(prim) // the surface moved, so the fresnel rim needs it
  }

  if (!DRY) await io.write(path, doc)
  return { height, vertices: count }
}

/**
 * Apply the body's own narrowing profile to a mesh that lives inside it.
 *
 * Without this the torso shrinks but the viscera do not, and the bowel ends up
 * poking through the abdominal wall — in the source data the male gut already
 * sat 1.5 cm proud of the skin, and taking the waist in made it worse. Running
 * the identical profile over the organs keeps every organ exactly as deep
 * inside the body as the anatomists placed it.
 */
async function conformToBody(path, sex, frame) {
  const { doc, prims } = await loadGeometry(path)
  const profile = BODY_PROFILE[sex]
  const halfSpan = (frame.max[0] - frame.min[0]) / 2
  const torsoHalf = halfSpan * 0.34
  const armStart = halfSpan * 0.56
  const cx = (frame.min[0] + frame.max[0]) / 2
  const cz = (frame.min[2] + frame.max[2]) / 2
  const height = frame.max[1] - frame.min[1]

  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION')
    const arr = pos.getArray()
    for (let i = 0; i < arr.length; i += 3) {
      const t = (arr[i + 1] - frame.min[1]) / height
      const { sx, sz } = sampleProfile(profile, t)
      const dx = arr[i] - cx
      const w = torsoFalloff(dx, torsoHalf, armStart)
      arr[i] = cx + dx * (1 + (sx - 1) * w)
      arr[i + 2] = cz + (arr[i + 2] - cz) * sz
    }
    pos.setArray(arr)
    recomputeNormals(prim)
  }
  if (!DRY) await io.write(path, doc)
}

/* ------------------------------- organs -------------------------------- */

/** Longest-axis size in metres for a 1.80 m adult, scaled per body height. */
const ORGAN_SIZE = {
  heart: 0.12,
  liver: 0.21,
  'kidney-l': 0.115,
  'kidney-r': 0.115,
  'gut-small': 0.24, // the coiled mass, not the unravelled length
  'gut-large': 0.36, // the colon frame
}

/**
 * Where each organ belongs vertically, as a fraction of stature from the feet.
 * Landmarks: navel 0.60, xiphoid 0.68, nipple 0.72, clavicle 0.80.
 */
const ORGAN_BAND = {
  lung: [0.63, 0.815],
  heart: [0.7, 0.79],
  liver: [0.62, 0.72],
  'kidney-l': [0.59, 0.68],
  'kidney-r': [0.59, 0.68],
  'gut-small': [0.5, 0.62],
  'gut-large': [0.46, 0.66],
}

async function fixOrgan(path, { sizeTarget, shrinkOnly, band, alignTop, stature, feet }) {
  const { doc, prims, min, max } = await loadGeometry(path)
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]

  // 1. size — uniform, about the organ's own centre so it stays put
  let factor = 1
  if (sizeTarget) {
    const f = sizeTarget / Math.max(...span)
    // bowel is only ever trimmed: inflating it is what crowded the chest
    if (Math.abs(f - 1) >= 0.06 && !(shrinkOnly && f > 1)) factor = f
  }

  // 2. vertical placement
  let shift = 0
  if (band) {
    const halfSpan = (span[1] * factor) / 2
    const target = alignTop
      ? // pin the apex to the top of the band: big lungs then fill the chest
        // downward instead of pushing up into the neck
        feet + band[1] * stature - halfSpan
      : feet + ((band[0] + band[1]) / 2) * stature
    const d = target - centre[1]
    if (Math.abs(d) >= 0.005) shift = d
  }

  if (factor === 1 && shift === 0) return { factor, shift, before: centre[1], span: span[1] }

  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION')
    const arr = pos.getArray()
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = centre[0] + (arr[i] - centre[0]) * factor
      arr[i + 1] = centre[1] + (arr[i + 1] - centre[1]) * factor + shift
      arr[i + 2] = centre[2] + (arr[i + 2] - centre[2]) * factor
    }
    pos.setArray(arr)
  }
  if (!DRY) await io.write(path, doc)
  return { factor, shift, before: centre[1], span: span[1] }
}

/* --------------------------------- run --------------------------------- */

for (const sex of ['male', 'female']) {
  const dir = `public/models/anatomy/${sex}`

  // frame of the body BEFORE reshaping — organs must follow the same transform
  const frame = await loadGeometry(`${dir}/skin.glb`)

  if (BODIES.includes(sex)) {
    const r = await reshapeBody(`${dir}/skin.glb`, sex)
    console.log(`\n=== ${sex} body === ${r.height.toFixed(2)} m · ${r.vertices.toLocaleString()} vertices reshaped`)
  } else {
    console.log(`\n=== ${sex} body === left untouched`)
  }

  // stature is read back from the body so organ placement follows any reshape
  const skin = await loadGeometry(`${dir}/skin.glb`)
  const feet = skin.min[1]
  const stature = skin.max[1] - feet
  const heightScale = stature / 1.8

  const organs = new Set([...Object.keys(ORGAN_SIZE), ...Object.keys(ORGAN_BAND)])
  for (const organ of organs) {
    const r = await fixOrgan(`${dir}/${organ}.glb`, {
      sizeTarget: ORGAN_SIZE[organ] ? ORGAN_SIZE[organ] * heightScale : null,
      shrinkOnly: organ.startsWith('gut'),
      band: ORGAN_BAND[organ],
      alignTop: organ === 'lung',
      stature,
      feet,
    })
    const top = ((r.before + r.shift + (r.span * r.factor) / 2 - feet) / stature).toFixed(3)
    const parts = []
    if (r.factor !== 1) parts.push(`×${r.factor.toFixed(2)}`)
    if (r.shift !== 0) parts.push(`${r.shift > 0 ? '↑' : '↓'}${Math.abs(r.shift * 100).toFixed(1)}cm`)
    if (BODIES.includes(sex)) await conformToBody(`${dir}/${organ}.glb`, sex, frame)
    console.log(`  ${organ.padEnd(10)} ${parts.join(' ').padEnd(16)} top now ${top} of stature`)
  }
}
console.log(DRY ? '\nDry run — nothing written.' : '\nWritten.')
