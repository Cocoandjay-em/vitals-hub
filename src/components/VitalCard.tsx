import type { Flag } from '@/types/biomarker'
import { FLAG_COLOR } from '@/lib/flags'
import { cn } from '@/lib/utils'

export interface VitalSeries {
  /** e.g. 'Blood Pressure Systolic' */
  name: string
  unit: string
  points: { date: string; value: number; flag: Flag }[]
}

interface VitalCardProps {
  title: string
  icon: React.ReactNode
  /** one series (weight, HR, temp) or two (BP sys/dia) */
  series: VitalSeries[]
  /** second value label for paired vitals, e.g. diastolic */
  pairLabels?: [string, string]
  onOpen: (markerName: string) => void
}

const W = 120
const H = 34
const PAD = 3

function Sparkline({ points, color }: { points: { value: number }[]; color: string }) {
  if (points.length === 0) return null
  const vals = points.map((p) => p.value)
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (min === max) {
    min -= 1
    max += 1
  }
  const x = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeOpacity="0.9" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r="2.2" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  )
}

export function VitalCard({ title, icon, series, pairLabels, onOpen }: VitalCardProps) {
  const primary = series[0]
  const secondary = series[1]
  const last = primary?.points[primary.points.length - 1]
  const last2 = secondary?.points[secondary.points.length - 1]
  const flag: Flag = last?.flag ?? 'unknown'
  const color = FLAG_COLOR[flag]
  const hasData = Boolean(last)

  return (
    <button
      onClick={() => primary && onOpen(primary.name)}
      disabled={!hasData}
      className={cn(
        'group relative w-full rounded-sm border border-cyan-400/20 bg-[#020817]/70 px-3 py-2.5 text-left backdrop-blur-sm transition',
        hasData ? 'hover:border-cyan-300/50 hover:bg-[#041025]/80' : 'cursor-default opacity-50',
      )}
      style={{ boxShadow: hasData ? `0 0 18px ${color}14, inset 0 0 24px rgba(34,211,238,0.04)` : undefined }}
      title={hasData ? `${title} — click for full history` : `${title} — no data yet`}
    >
      <div className="flex items-center justify-between">
        <span className="hud-mono flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-cyan-100/50">
          {icon}
          {title}
        </span>
        {hasData && (
          <span
            className="hud-mono rounded-sm border px-1 py-px text-[8px] tracking-wider"
            style={{ color, borderColor: `${color}55`, background: `${color}14` }}
          >
            {flag === 'unknown' ? 'NO REF' : flag.toUpperCase()}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        {hasData ? (
          <>
            <span
              className="hud-mono text-xl font-bold tracking-wider"
              style={{ color, textShadow: `0 0 12px ${color}66` }}
            >
              {last.value}
              {last2 ? `/${last2.value}` : ''}
            </span>
            <span className="hud-mono text-[9px] tracking-wider text-cyan-100/40">{primary.unit}</span>
          </>
        ) : (
          <span className="hud-mono text-xl font-bold tracking-wider text-cyan-100/25">—</span>
        )}
      </div>

      {pairLabels && last2 && (
        <p className="hud-mono mt-0.5 text-[8px] tracking-wider text-cyan-100/35">
          {pairLabels[0]} {last.value} · {pairLabels[1]} {last2.value}
        </p>
      )}

      <div className="mt-1.5">
        {hasData && primary.points.length > 1 ? (
          <Sparkline points={primary.points} color={color} />
        ) : (
          <p className="hud-mono py-1 text-[8px] tracking-wider text-cyan-100/30">
            {hasData ? '1 READING — ADD MORE FOR TREND' : 'ADD VIA MANUAL + OR APPLE HEALTH'}
          </p>
        )}
      </div>

      <p className="hud-mono mt-1 text-[8px] tracking-wider text-cyan-100/30">
        {hasData ? `${last.date} · ${primary.points.length} READING${primary.points.length === 1 ? '' : 'S'}` : ''}
      </p>
    </button>
  )
}
