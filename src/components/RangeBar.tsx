import type { Flag } from '@/types/biomarker'

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

interface RangeBarProps {
  value: number
  refLow: number | null
  refHigh: number | null
  flag: Flag
}

/**
 * Visual reference-range bar: dim track, highlighted normal band,
 * value marker colored by flag. Handles <hi / >lo one-sided ranges.
 */
export function RangeBar({ value, refLow, refHigh, flag }: RangeBarProps) {
  if (refLow === null && refHigh === null) {
    return (
      <div className="flex h-4 items-center">
        <div className="h-[3px] w-full rounded bg-slate-500/25" />
      </div>
    )
  }

  // build a display scale that contains value and the range with padding
  const lo = refLow ?? refHigh! * 0.5
  const hi = refHigh ?? (refLow! === 0 ? refLow! + 2 : refLow! * 2)
  const span = hi - lo || Math.abs(hi) || 1
  const min = Math.min(lo - span * 0.35, value - span * 0.15)
  const max = Math.max(hi + span * 0.35, value + span * 0.15)
  const scale = (v: number) => ((v - min) / (max - min)) * 100

  const bandLeft = scale(refLow ?? min)
  const bandRight = scale(refHigh ?? max)
  const marker = Math.max(0, Math.min(100, scale(value)))
  const color = FLAG_COLORS[flag]

  return (
    <div className="relative h-4 w-full" role="img" aria-label={`value ${value}, reference ${refLow ?? '—'} to ${refHigh ?? '—'}`}>
      {/* track */}
      <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded bg-slate-500/25" />
      {/* normal band */}
      <div
        className="absolute top-1/2 h-[7px] -translate-y-1/2 rounded-sm"
        style={{
          left: `${bandLeft}%`,
          width: `${Math.max(1.5, bandRight - bandLeft)}%`,
          background: 'rgba(52,211,153,0.16)',
          border: '1px solid rgba(52,211,153,0.45)',
          boxShadow: '0 0 8px rgba(52,211,153,0.25)',
        }}
      />
      {/* band edge ticks */}
      <div className="absolute top-1/2 h-[11px] w-px -translate-y-1/2 bg-emerald-400/60" style={{ left: `${bandLeft}%` }} />
      <div className="absolute top-1/2 h-[11px] w-px -translate-y-1/2 bg-emerald-400/60" style={{ left: `${bandRight}%` }} />
      {/* value marker */}
      <div
        className="absolute top-1/2 h-[13px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: `${marker}%`, background: color, boxShadow: `0 0 8px ${color}, 0 0 3px ${color}` }}
      />
    </div>
  )
}

export function FlagBadge({ flag }: { flag: Flag }) {
  const color = FLAG_COLORS[flag]
  return (
    <span
      className="hud-mono inline-block rounded-sm border px-1.5 py-px text-[10px] tracking-widest"
      style={{
        color,
        borderColor: `${color}66`,
        background: `${color}14`,
        boxShadow: `0 0 8px ${color}33`,
      }}
    >
      {FLAG_LABELS[flag]}
    </span>
  )
}
