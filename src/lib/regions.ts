import type { BiomarkerReading, Category, Flag } from '@/types/biomarker'
import type { ClinicalReport, Stage } from '@/types/report'
import { STAGE_COLOR, STAGE_RANK } from '@/types/report'
import { FLAG_COLOR } from '@/lib/flags'

/**
 * Organ regions of the body scan: which biomarker categories belong to each
 * organ, and how a region's severity and colour are derived from its markers
 * and its attached clinical reports.
 *
 * The 3D anchors come from the real organ meshes (see BodyScan3D), so a region
 * only needs its identity and the categories it owns.
 */

export type RegionId = 'brain' | 'neck' | 'heart' | 'lungs' | 'liver' | 'gut' | 'kidney' | 'systemic'

export interface RegionDef {
  id: RegionId
  /** human-readable name for the info card */
  title: string
  /** short uppercase tag for the on-body label chip (keeps chips narrow) */
  tag: string
  categories: Category[]
}

export const REGIONS: RegionDef[] = [
  {
    id: 'brain',
    title: 'Brain & Nervous System',
    tag: 'BRAIN',
    // no blood-panel category maps here: the brain is driven by clinical reports
    categories: [],
  },
  { id: 'neck', title: 'Thyroid & Hormones', tag: 'THYROID', categories: ['Thyroid', 'Hormones'] },
  { id: 'heart', title: 'Heart & Lipids', tag: 'HEART', categories: ['Lipids'] },
  { id: 'lungs', title: 'Lungs & Inflammation', tag: 'LUNGS', categories: ['Inflammation'] },
  { id: 'liver', title: 'Liver', tag: 'LIVER', categories: ['Liver'] },
  { id: 'gut', title: 'Gut & Glucose', tag: 'GUT', categories: ['Metabolic', 'Glucose'] },
  { id: 'kidney', title: 'Kidneys', tag: 'KIDNEY', categories: ['Kidney'] },
  { id: 'systemic', title: 'Blood & Systemic', tag: 'BLOOD', categories: ['CBC', 'Vitamins', 'Other'] },
]

/** worst-first ranking for the hotspot colour */
const FLAG_RANK: Record<Flag, number> = { high: 4, low: 3, unknown: 2, normal: 1 }

/** Flag severity on the same scale as STAGE_RANK, so the two can be compared. */
const FLAG_SEVERITY: Record<Flag, number> = { high: 3, low: 3, unknown: 0, normal: 1 }

export interface RegionState {
  def: RegionDef
  markers: BiomarkerReading[]
  worst: Flag
  highCount: number
  lowCount: number
  label: string
  /** marker to select on click: first flagged, else first */
  target: string
  /** 0..1 — how far the worst value sits beyond its reference bound */
  intensity: number
  /** clinical reports attached to this region, newest visit first */
  reports: ClinicalReport[]
  /** worst documented stage across those reports (null when there are none) */
  stage: Stage | null
}

/** Relative deviation beyond the violated reference bound (0 when in range). */
function deviation(m: BiomarkerReading): number {
  if (m.flag === 'high' && m.refHigh != null && m.refHigh !== 0) {
    return Math.max(0, (m.value - m.refHigh) / Math.abs(m.refHigh))
  }
  if (m.flag === 'low' && m.refLow != null && m.refLow !== 0) {
    return Math.max(0, (m.refLow - m.value) / Math.abs(m.refLow))
  }
  return 0
}

/** Glow strength for a staged report, so a report alone still lights the organ. */
function stageIntensity(stage: Stage): number {
  return Math.min(1, 0.3 + STAGE_RANK[stage] * 0.14)
}

/**
 * A region's colour: whichever signal is more severe wins — an out-of-range
 * biomarker or a staged clinical report. Ties go to the report, which is the
 * more specific clinical statement.
 */
export function regionColor(r: RegionState): string {
  if (!r.stage) return FLAG_COLOR[r.worst]
  return STAGE_RANK[r.stage] >= FLAG_SEVERITY[r.worst] ? STAGE_COLOR[r.stage] : FLAG_COLOR[r.worst]
}

/** A region lights up when it has markers or at least one attached report. */
export function regionHasData(r: RegionState): boolean {
  return r.markers.length > 0 || r.reports.length > 0
}

export function buildRegions(
  markers: BiomarkerReading[],
  reports: ClinicalReport[] = [],
): RegionState[] {
  const out: RegionState[] = []
  for (const def of REGIONS) {
    const inRegion = markers.filter((m) => def.categories.includes(m.category))
    const regionReports = reports
      .filter((r) => r.region === def.id)
      .sort((a, b) => b.date.localeCompare(a.date))
    const stage = regionReports.reduce<Stage | null>(
      (acc, r) => (acc === null || STAGE_RANK[r.stage] > STAGE_RANK[acc] ? r.stage : acc),
      null,
    )
    const reportTag = regionReports.length > 0 ? ` · ${regionReports.length}R` : ''

    if (inRegion.length === 0) {
      // always render every region — empty ones get a dim "no data" dot that
      // still opens the info card with a static organ description
      out.push({
        def,
        markers: [],
        worst: 'unknown',
        highCount: 0,
        lowCount: 0,
        label: stage ? `${def.tag} · ${stage.toUpperCase()}` : `${def.tag} · NO DATA`,
        target: '',
        intensity: stage ? stageIntensity(stage) : 0,
        reports: regionReports,
        stage,
      })
      continue
    }

    const worst = inRegion.reduce<Flag>(
      (acc, m) => (FLAG_RANK[m.flag] > FLAG_RANK[acc] ? m.flag : acc),
      'normal',
    )
    const highCount = inRegion.filter((m) => m.flag === 'high').length
    const lowCount = inRegion.filter((m) => m.flag === 'low').length
    const unknownCount = inRegion.filter((m) => m.flag === 'unknown').length
    const parts: string[] = []
    if (highCount > 0) parts.push(`${highCount}H`)
    if (lowCount > 0) parts.push(`${lowCount}L`)
    if (parts.length === 0) parts.push(unknownCount === inRegion.length ? 'NO REF' : 'OK')
    const flagged = inRegion.find((m) => m.flag === 'high' || m.flag === 'low')
    // any flagged marker glows at least softly; further out-of-range => brighter, capped
    const maxDev = Math.max(0, ...inRegion.map(deviation))
    const intensity = maxDev > 0 ? Math.min(1, 0.35 + maxDev) : worst === 'unknown' ? 0.15 : 0

    out.push({
      def,
      markers: inRegion,
      worst,
      highCount,
      lowCount,
      label: `${def.tag} · ${parts.join(' · ')}${reportTag}`,
      target: (flagged ?? inRegion[0]).name,
      intensity: stage ? Math.max(intensity, stageIntensity(stage)) : intensity,
      reports: regionReports,
      stage,
    })
  }
  return out
}
