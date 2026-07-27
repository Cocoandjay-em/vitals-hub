import { useMemo } from 'react'
import type { BiomarkerReading } from '@/types/biomarker'
import { FLAG_COLORS } from '@/lib/flags'

export interface TrendPoint {
  date: string
  reading: BiomarkerReading
}

interface TrendChartProps {
  name: string
  unit: string
  refLow: number | null
  refHigh: number | null
  points: TrendPoint[] // sorted by date ascending
}

const W = 720
const H = 260
const PAD = { top: 26, right: 76, bottom: 34, left: 48 }

/** Hand-rolled SVG trend chart with shaded reference band and flag-colored points. */
export function TrendChart({ name, unit, refLow, refHigh, points }: TrendChartProps) {
  const geom = useMemo(() => {
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const values = points.map((p) => p.reading.value)
    if (refLow !== null) values.push(refLow)
    if (refHigh !== null) values.push(refHigh)
    let vMin = Math.min(...values)
    let vMax = Math.max(...values)
    if (vMin === vMax) {
      vMin -= 1
      vMax += 1
    }
    const padV = (vMax - vMin) * 0.18
    vMin -= padV
    vMax += padV

    const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
    const y = (v: number) => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * innerH

    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.reading.value).toFixed(1)}`).join(' ')

    const yTicks = Array.from({ length: 5 }, (_, i) => vMin + ((vMax - vMin) * i) / 4)

    // max ~6 x labels
    const step = Math.max(1, Math.ceil(points.length / 6))
    const xTicks = points
      .map((p, i) => ({ p, i }))
      .filter(({ i }) => i % step === 0 || i === points.length - 1)

    const bandTop = refHigh !== null ? y(refHigh) : PAD.top
    const bandBottom = refLow !== null ? y(refLow) : PAD.top + innerH

    return { x, y, path, yTicks, xTicks, bandTop, bandBottom, vMin, vMax, innerH, innerW }
  }, [points, refLow, refHigh])

  if (points.length === 0) return null
  const latest = points[points.length - 1]
  const hasBand = refLow !== null || refHigh !== null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Trend of ${name}`}>
      <defs>
        <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(52,211,153,0.14)" />
          <stop offset="100%" stopColor="rgba(52,211,153,0.05)" />
        </linearGradient>
        <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* horizontal gridlines + y ticks */}
      {geom.yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(v)} y2={geom.y(v)} stroke="rgba(34,211,238,0.1)" strokeWidth="1" strokeDasharray="3 6" />
          <text x={PAD.left - 8} y={geom.y(v) + 3} textAnchor="end" fontSize="9" fill="rgba(165,243,252,0.5)" className="hud-mono">
            {v >= 100 ? Math.round(v) : v.toFixed(1)}
          </text>
        </g>
      ))}

      {/* reference band */}
      {hasBand && (
        <g>
          <rect x={PAD.left} y={geom.bandTop} width={geom.innerW} height={Math.max(2, geom.bandBottom - geom.bandTop)} fill="url(#bandGrad)" />
          {refHigh !== null && (
            <line x1={PAD.left} x2={W - PAD.right} y1={geom.bandTop} y2={geom.bandTop} stroke="rgba(52,211,153,0.55)" strokeWidth="1" strokeDasharray="6 4" />
          )}
          {refLow !== null && (
            <line x1={PAD.left} x2={W - PAD.right} y1={geom.bandBottom} y2={geom.bandBottom} stroke="rgba(52,211,153,0.55)" strokeWidth="1" strokeDasharray="6 4" />
          )}
          <text x={W - PAD.right + 6} y={geom.bandTop + 3} fontSize="8" fill="rgba(52,211,153,0.75)" className="hud-mono">
            {refHigh !== null ? `HI ${refHigh}` : ''}
          </text>
          <text x={W - PAD.right + 6} y={geom.bandBottom + 3} fontSize="8" fill="rgba(52,211,153,0.75)" className="hud-mono">
            {refLow !== null ? `LO ${refLow}` : ''}
          </text>
        </g>
      )}

      {/* trend line */}
      {points.length > 1 && (
        <path d={geom.path} fill="none" stroke="#22d3ee" strokeWidth="1.6" filter="url(#lineGlow)" opacity="0.9" />
      )}

      {/* points */}
      {points.map((p, i) => {
        const color = FLAG_COLORS[p.reading.flag]
        const isLatest = i === points.length - 1
        return (
          <g key={p.date}>
            <circle cx={geom.x(i)} cy={geom.y(p.reading.value)} r={isLatest ? 5 : 3.5} fill={color} stroke="#020817" strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
            {isLatest && <circle cx={geom.x(i)} cy={geom.y(p.reading.value)} r={9} fill="none" stroke={color} strokeWidth="1" opacity="0.5" />}
          </g>
        )
      })}

      {/* latest direct label */}
      <text
        x={Math.min(geom.x(points.length - 1) + 12, W - 70)}
        y={geom.y(latest.reading.value) - 10}
        fontSize="11"
        fontWeight="700"
        fill={FLAG_COLORS[latest.reading.flag]}
        className="hud-mono"
        style={{ filter: `drop-shadow(0 0 6px ${FLAG_COLORS[latest.reading.flag]})` }}
      >
        {latest.reading.value} {unit}
      </text>

      {/* x ticks */}
      {geom.xTicks.map(({ p, i }) => (
        <text key={p.date} x={geom.x(i)} y={H - 12} textAnchor="middle" fontSize="9" fill="rgba(165,243,252,0.55)" className="hud-mono">
          {p.date.slice(5)}
        </text>
      ))}

      {/* frame */}
      <rect x={PAD.left} y={PAD.top} width={geom.innerW} height={geom.innerH} fill="none" stroke="rgba(34,211,238,0.18)" strokeWidth="1" />
    </svg>
  )
}
