import type { Category, TestRecord } from '@/types/biomarker'

interface DemoMarker {
  name: string
  category: Category
  unit: string
  lo: number | null
  hi: number | null
  values: [number, number, number] // oldest -> newest
}

const MARKERS: DemoMarker[] = [
  { name: 'Hemoglobin', category: 'CBC', unit: 'g/dL', lo: 12.0, hi: 15.5, values: [13.1, 13.8, 14.2] },
  { name: 'WBC', category: 'CBC', unit: '10*9/L', lo: 4.0, hi: 10.0, values: [6.2, 7.1, 11.4] },
  { name: 'Platelets', category: 'CBC', unit: '10*9/L', lo: 150, hi: 400, values: [244, 231, 256] },
  { name: 'Total Cholesterol', category: 'Lipids', unit: 'mg/dL', lo: null, hi: 200, values: [226, 214, 198] },
  { name: 'HDL Cholesterol', category: 'Lipids', unit: 'mg/dL', lo: 40, hi: null, values: [48, 52, 55] },
  { name: 'LDL Cholesterol', category: 'Lipids', unit: 'mg/dL', lo: null, hi: 100, values: [148, 132, 118] },
  { name: 'Triglycerides', category: 'Lipids', unit: 'mg/dL', lo: null, hi: 150, values: [182, 160, 124] },
  { name: 'Glucose', category: 'Glucose', unit: 'mg/dL', lo: 70, hi: 99, values: [94, 101, 97] },
  { name: 'HbA1c', category: 'Glucose', unit: '%', lo: 4.0, hi: 5.6, values: [5.4, 5.7, 5.5] },
  { name: 'Creatinine', category: 'Kidney', unit: 'mg/dL', lo: 0.7, hi: 1.3, values: [0.92, 0.88, 0.95] },
  { name: 'ALT', category: 'Liver', unit: 'U/L', lo: 7, hi: 45, values: [28, 41, 52] },
  { name: 'TSH', category: 'Thyroid', unit: 'mIU/L', lo: 0.4, hi: 4.2, values: [2.1, 2.8, 1.9] },
  { name: 'Vitamin D', category: 'Vitamins', unit: 'ng/mL', lo: 30, hi: 100, values: [24, 28, 33] },
  { name: 'Ferritin', category: 'Vitamins', unit: 'ng/mL', lo: 20, hi: 250, values: [66, 58, 71] },
  { name: 'hs-CRP', category: 'Inflammation', unit: 'mg/L', lo: null, hi: 3.0, values: [1.2, 2.6, 3.8] },
]

function flag(v: number, lo: number | null, hi: number | null) {
  if (hi !== null && v > hi) return 'high' as const
  if (lo !== null && v < lo) return 'low' as const
  if (lo === null && hi === null) return 'unknown' as const
  return 'normal' as const
}

/** Three plausible sample tests ~4 months apart, clearly labelled as demo data. */
export function buildDemoRecords(): TestRecord[] {
  const now = new Date()
  const dates = [8, 4, 0].map((monthsBack) => {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 12)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  return dates.map((date, i) => ({
    id: `demo_${i}_${date}`,
    date,
    sources: ['Demo data'],
    demo: true,
    createdAt: new Date().toISOString(),
    markers: MARKERS.map((m) => ({
      name: m.name,
      category: m.category,
      value: m.values[i],
      unit: m.unit,
      refLow: m.lo,
      refHigh: m.hi,
      flag: flag(m.values[i], m.lo, m.hi),
    })),
  }))
}
