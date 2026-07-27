// Inflate the Visible Human lungs to realistic size.
// The donor lungs were deflated in the source scan: lobe bases sit ~0.39
// (should reach the diaphragm ~0.30) and the chest is under-filled.
// Fix: scale ONLY the bronchopulmonary segment meshes (the lung tissue)
// about a pivot near the hilum — airways/cartilage keep the trachea
// connected to the throat. Normals are recomputed afterwards.
import { NodeIO } from '@gltf-transform/core'
import { normals } from '@gltf-transform/functions'

const JOBS = [
  // male: lobes y 0.386..0.615 → ~0.30..0.63, x ±0.134 → ±0.16
  {
    file: 'public/models/anatomy/male/lung.glb',
    pivot: [0, 0.56, 0],
    scale: [1.2, 1.3, 1.25],
    match: (n) => n.includes('bronchopulmonary_segment'),
  },
  // female: lobe tissue lives in two big meshes (the 152k-vert one is the
  // lobes despite its cartilage label); base 0.367 → ~0.30, apex into neck
  {
    file: 'public/models/anatomy/female/lung.glb',
    pivot: [0, 0.58, 0],
    scale: [1.15, 1.3, 1.2],
    match: (n) => n === 'VH_F_hilum_L' || n === 'VH_F_corniculate_cartilage_L',
  },
]

const io = new NodeIO()
for (const { file, pivot, scale, match } of JOBS) {
  const doc = await io.read(file)
  let touched = 0
  for (const node of doc.getRoot().listNodes()) {
    if (!match(node.getName())) continue
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const arr = pos.getArray()
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = pivot[0] + scale[0] * (arr[i] - pivot[0])
        arr[i + 1] = pivot[1] + scale[1] * (arr[i + 1] - pivot[1])
        arr[i + 2] = pivot[2] + scale[2] * (arr[i + 2] - pivot[2])
      }
      pos.setArray(arr)
      touched++
    }
  }
  await doc.transform(normals({ overwrite: true }))
  await io.write(file, doc)
  console.log(`${file}: scaled ${touched} lobe primitives by ${scale} about ${pivot}`)
}
