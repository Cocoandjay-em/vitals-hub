import type { Flag } from '@/types/biomarker'

/**
 * Flag palettes. Two of them on purpose: on the body map an unknown flag is the
 * HUD's idle cyan (the organ is simply unlit), while in tables and charts the
 * same flag must read as "no reference range" — muted slate.
 */

/** Body-map / organ palette. */
export const FLAG_COLOR: Record<Flag, string> = {
  high: '#f43f5e',
  low: '#f59e0b',
  normal: '#34d399',
  unknown: '#22d3ee',
}

/** Table, badge and chart palette. */
export const FLAG_COLORS: Record<Flag, string> = {
  high: '#f43f5e',
  low: '#f59e0b',
  normal: '#34d399',
  unknown: '#64748b',
}

export const FLAG_LABELS: Record<Flag, string> = {
  high: 'HIGH',
  low: 'LOW',
  normal: 'NORMAL',
  unknown: 'N/A',
}
