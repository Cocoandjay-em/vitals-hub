import type { RegionId } from '@/components/BodyMap'

/**
 * Clinical reports: narrative documents from a specialist visit (neurology,
 * cardiology…) that carry no biomarker rows. They attach to one organ region
 * of the body map and carry a severity stage the AI proposes and the user
 * confirms or overrides.
 */

/** Documented severity — reflects what the report states, never a new diagnosis. */
export type Stage = 'normal' | 'mild' | 'moderate' | 'severe' | 'critical' | 'unknown'

export const STAGES: Stage[] = ['normal', 'mild', 'moderate', 'severe', 'critical', 'unknown']

export const STAGE_LABEL: Record<Stage, string> = {
  normal: 'NORMAL',
  mild: 'MILD',
  moderate: 'MODERATE',
  severe: 'SEVERE',
  critical: 'CRITICAL',
  unknown: 'UNSTAGED',
}

/** Severity ramp: emerald → lime → amber → rose → red, slate for unstaged. */
export const STAGE_COLOR: Record<Stage, string> = {
  normal: '#34d399',
  mild: '#a3e635',
  moderate: '#f59e0b',
  severe: '#f43f5e',
  critical: '#ff2d55',
  unknown: '#64748b',
}

export const STAGE_RANK: Record<Stage, number> = {
  critical: 5,
  severe: 4,
  moderate: 3,
  mild: 2,
  normal: 1,
  unknown: 0,
}

export interface ClinicalReport {
  id: string
  /** ISO yyyy-mm-dd — the date of the visit, not the print date */
  date: string
  title: string
  specialty: string
  region: RegionId
  stage: Stage
  /** who set the current stage — the AI proposal or a human override */
  stageSource: 'ai' | 'user'
  /** why the AI proposed this stage (kept even after a user override) */
  stageRationale: string
  summary: string
  findings: string[]
  followUp: string
  fileName: string
  /** true when the original document is stored on the server */
  hasFile: boolean
  createdAt: string
}

/** What the AI proposes after reading a report — nothing is saved until confirmed. */
export interface ReportAnalysis {
  fileName: string
  date: string | null
  title: string
  specialty: string
  region: RegionId
  stage: Stage
  stageRationale: string
  summary: string
  findings: string[]
  followUp: string
  error?: string
}
