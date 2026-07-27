import { cn } from '@/lib/utils'

interface HudDialProps {
  value: number
  total: number
  label: string
  color: string // hex
  glowClass?: string
}

/** Circular HUD dial: arc fills proportionally to value/total. */
export function HudDial({ value, total, label, color, glowClass }: HudDialProps) {
  const size = 84
  const stroke = 5
  const r = (size - stroke) / 2 - 4
  const cx = size / 2
  const circumference = 2 * Math.PI * r
  const frac = total > 0 ? Math.min(1, value / total) : 0
  const dash = frac * circumference

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* outer tick ring */}
        <circle cx={cx} cy={cx} r={r + 6} fill="none" stroke="rgba(34,211,238,0.12)" strokeWidth="1" strokeDasharray="2 5" />
        {/* track */}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={stroke} />
        {/* value arc, starting at top */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray 600ms ease' }}
        />
        <text
          x={cx}
          y={cx + 5}
          textAnchor="middle"
          className={cn('hud-mono', glowClass)}
          fill={color}
          fontSize="20"
          fontWeight="700"
        >
          {value}
        </text>
      </svg>
      <span className="hud-label" style={{ color }}>{label}</span>
    </div>
  )
}
