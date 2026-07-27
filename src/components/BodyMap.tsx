import { useEffect, useMemo, useRef, useState } from 'react'
import type { BiomarkerReading, Category, Flag } from '@/types/biomarker'
import type { ClinicalReport, Stage } from '@/types/report'
import { STAGE_COLOR, STAGE_RANK } from '@/types/report'
import { cn } from '@/lib/utils'
import { OrganInfo } from '@/components/OrganInfo'

export type RegionId = 'brain' | 'neck' | 'heart' | 'lungs' | 'liver' | 'gut' | 'kidney' | 'systemic'

/** One organ-shaped glow: ellipse centred at (x,y) % of the hologram container. */
interface GlowShape {
  x: number
  y: number
  /** width / height as % of container */
  w: number
  h: number
  rotate?: number
}

interface RegionDef {
  id: RegionId
  /** human-readable name for the info card */
  title: string
  /** short uppercase tag for the on-body label chip (keeps chips narrow) */
  tag: string
  /** organ-shaped glow overlays (empty for systemic — vessel streaks instead) */
  shapes: GlowShape[]
  categories: Category[]
  /** interactive anchor dot + zoom target, % of container */
  dot: { x: number; y: number }
  /** where the label chip goes relative to the dot */
  chipSide: 'left' | 'right' | 'below' | 'above'
}

/**
 * Geometry tuned to public/body-hologram.png (aspect 1024×1435, front view —
 * the body's right side appears on the viewer's left, so the liver glow sits left).
 * Centers measured at full resolution against the actual hologram image.
 */
export const REGIONS: RegionDef[] = [
  {
    id: 'brain',
    title: 'Brain & Nervous System',
    tag: 'BRAIN',
    shapes: [{ x: 50, y: 7.5, w: 9, h: 5 }],
    // no blood-panel category maps here: the brain is driven by clinical reports
    categories: [],
    dot: { x: 50, y: 7.5 },
    chipSide: 'right',
  },
  {
    id: 'neck',
    title: 'Thyroid & Hormones',
    tag: 'THYROID',
    shapes: [{ x: 50, y: 18.5, w: 8, h: 3.2 }],
    categories: ['Thyroid', 'Hormones'],
    dot: { x: 50, y: 18.5 },
    chipSide: 'above', // 'below' collided with the lungs chip
  },
  {
    id: 'heart',
    title: 'Heart & Lipids',
    tag: 'HEART',
    shapes: [{ x: 50.6, y: 25.5, w: 7.5, h: 4.5, rotate: -12 }],
    categories: ['Lipids'],
    dot: { x: 50.6, y: 25.5 },
    chipSide: 'right',
  },
  {
    id: 'lungs',
    title: 'Lungs & Inflammation',
    tag: 'LUNGS',
    shapes: [
      { x: 43, y: 26.5, w: 9.5, h: 7 },
      { x: 57, y: 26.5, w: 9.5, h: 7 },
    ],
    categories: ['Inflammation'],
    dot: { x: 50.5, y: 23 }, // carina — between the lobes
    chipSide: 'right',
  },
  {
    id: 'liver',
    title: 'Liver',
    tag: 'LIVER',
    shapes: [{ x: 44.5, y: 36, w: 16, h: 5.5, rotate: -10 }],
    categories: ['Liver'],
    dot: { x: 44.5, y: 36 },
    chipSide: 'left',
  },
  {
    id: 'gut',
    title: 'Gut & Glucose',
    tag: 'GUT',
    shapes: [{ x: 50.5, y: 42, w: 15, h: 8 }],
    categories: ['Metabolic', 'Glucose'],
    dot: { x: 50.5, y: 42 },
    chipSide: 'right',
  },
  {
    id: 'kidney',
    title: 'Kidneys',
    tag: 'KIDNEY',
    shapes: [
      { x: 45, y: 38, w: 5, h: 3.6 },
      { x: 54.5, y: 38, w: 5, h: 3.6 },
    ],
    categories: ['Kidney'],
    dot: { x: 54.5, y: 38 },
    chipSide: 'above', // 'below' collided with the gut chip
  },
  {
    id: 'systemic',
    title: 'Blood & Systemic',
    tag: 'BLOOD',
    shapes: [], // vessel streaks rendered separately (see VESSEL_STREAKS)
    categories: ['CBC', 'Vitamins', 'Other'],
    dot: { x: 24, y: 52 }, // inner forearm veins — where blood draws happen
    chipSide: 'below', // chip above/below the dot — 'left' overflowed the narrow frame
  },
]

/**
 * Systemic "blood" highlighting: elongated capsule streaks following the
 * visible vasculature (aorta, inner arms, thighs/shins) instead of a uniform
 * body wash. Positions in % of the hologram container.
 */
const VESSEL_STREAKS: GlowShape[] = [
  { x: 50, y: 30, w: 1.8, h: 11, rotate: 0 }, // thoracic aorta
  { x: 50.2, y: 40, w: 1.6, h: 10, rotate: 0 }, // abdominal aorta
  { x: 31.5, y: 38, w: 1.6, h: 22, rotate: 22 }, // viewer-left inner arm
  { x: 68.5, y: 38, w: 1.6, h: 22, rotate: -22 }, // viewer-right inner arm
  { x: 43.5, y: 72, w: 2, h: 32, rotate: 3 }, // viewer-left thigh → shin
  { x: 56.5, y: 72, w: 2, h: 32, rotate: -3 }, // viewer-right thigh → shin
]

export const FLAG_COLOR: Record<Flag, string> = {
  high: '#f43f5e',
  low: '#f59e0b',
  normal: '#34d399',
  unknown: '#22d3ee',
}

// worst-first ranking for hotspot colour
const FLAG_RANK: Record<Flag, number> = { high: 4, low: 3, unknown: 2, normal: 1 }

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

/** Flag severity on the same scale as STAGE_RANK, so the two can be compared. */
const FLAG_SEVERITY: Record<Flag, number> = { high: 3, low: 3, unknown: 0, normal: 1 }

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

interface BodyMapProps {
  /** markers of the LATEST test; null/empty => empty state */
  markers: BiomarkerReading[] | null
  /** date of the latest test (shown in the info card) */
  date?: string
  selected: string | null
  /** marker chosen inside the floating card → trend chart */
  onSelectMarker: (name: string) => void
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
        // a staged report alone should still light the organ up
        intensity: stage ? Math.min(1, 0.3 + STAGE_RANK[stage] * 0.14) : 0,
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
      intensity: stage ? Math.max(intensity, Math.min(1, 0.3 + STAGE_RANK[stage] * 0.14)) : intensity,
      reports: regionReports,
      stage,
    })
  }
  return out
}

/** Rotating targeting reticle rings rendered behind the hologram. */
function Reticle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(34,211,238,0.14)" strokeWidth="0.8" strokeDasharray="2 7" className="hud-spin-slow" style={{ transformOrigin: '100px 100px' }} />
      <circle cx="100" cy="100" r="78" fill="none" stroke="rgba(34,211,238,0.1)" strokeWidth="0.6" strokeDasharray="30 12 4 12" className="hud-spin-rev" style={{ transformOrigin: '100px 100px' }} />
      <circle cx="100" cy="100" r="60" fill="none" stroke="rgba(34,211,238,0.08)" strokeWidth="0.5" />
      {/* crosshair ticks */}
      <line x1="100" y1="0" x2="100" y2="14" stroke="rgba(34,211,238,0.25)" strokeWidth="0.8" />
      <line x1="100" y1="186" x2="100" y2="200" stroke="rgba(34,211,238,0.25)" strokeWidth="0.8" />
      <line x1="0" y1="100" x2="14" y2="100" stroke="rgba(34,211,238,0.25)" strokeWidth="0.8" />
      <line x1="186" y1="100" x2="200" y2="100" stroke="rgba(34,211,238,0.25)" strokeWidth="0.8" />
    </svg>
  )
}

/** One glow layer; wrapper positions/rotates so the pulse can scale the inner layer. */
function GlowLayer({
  shape,
  color,
  intensity,
  delay = 0,
  capsule = false,
}: {
  shape: GlowShape
  color: string
  intensity: number
  delay?: number
  capsule?: boolean
}) {
  const lo = 0.35 + intensity * 0.2
  const hi = 0.65 + intensity * 0.3
  return (
    <div
      className="hud-glow-in pointer-events-none absolute"
      style={{
        left: `${shape.x}%`,
        top: `${shape.y}%`,
        width: `${shape.w}%`,
        height: `${shape.h}%`,
        transform: `translate(-50%, -50%)${shape.rotate ? ` rotate(${shape.rotate}deg)` : ''}`,
      }}
      aria-hidden="true"
    >
      <div
        className="hud-organ-pulse h-full w-full"
        style={
          {
            '--glow-lo': lo.toFixed(2),
            '--glow-hi': hi.toFixed(2),
            animationDelay: `${delay}s`,
            background: capsule
              ? `linear-gradient(180deg, transparent 0%, ${color}A6 18%, ${color}59 50%, ${color}A6 82%, transparent 100%)`
              : `radial-gradient(closest-side, ${color}B3 0%, ${color}59 45%, transparent 72%)`,
            filter: capsule ? 'blur(3px)' : 'blur(5px)',
            borderRadius: capsule ? '999px' : undefined,
            mixBlendMode: 'screen',
          } as React.CSSProperties
        }
      />
    </div>
  )
}

/** lg breakpoint tracking for zoom scale + card docking. */
function useIsLg(): boolean {
  const [isLg, setIsLg] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsLg(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isLg
}

export function BodyMap({ markers, date, selected, onSelectMarker }: BodyMapProps) {
  const isLg = useIsLg()
  const regions = useMemo(() => (markers ? buildRegions(markers) : []), [markers])
  const [zoomedId, setZoomedId] = useState<RegionId | null>(null)
  const zoomed = useMemo(
    () => regions.find((r) => r.def.id === zoomedId) ?? null,
    [regions, zoomedId],
  )

  const selectedRegion = useMemo(() => {
    if (!selected || !markers) return null
    const m = markers.find((x) => x.name === selected)
    if (!m) return null
    return REGIONS.find((r) => r.categories.includes(m.category))?.id ?? null
  }, [selected, markers])

  const empty = !markers || markers.length === 0

  // pan-while-zoomed: drag anywhere on the backdrop to shift the view;
  // a click (no drag) zooms back out
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null)

  // reset pan whenever the zoom target changes
  useEffect(() => {
    setPan({ x: 0, y: 0 })
    setDragging(false)
    dragRef.current = null
  }, [zoomedId])

  // ESC zooms back out
  useEffect(() => {
    if (!zoomedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomedId])

  // zoom transform: keeps the target point centred — translate+scale both animate
  const scale = zoomed ? (isLg ? 2 : 1.4) : 1
  const zoomX = zoomed ? zoomed.def.dot.x : 50
  const zoomY = zoomed ? zoomed.def.dot.y : 50
  const transform = zoomed
    ? `translate(calc(${(50 - zoomX) * scale}% + ${pan.x}px), calc(${(50 - zoomY) * scale}% + ${pan.y}px)) scale(${scale})`
    : `translate(${(50 - zoomX) * scale}%, ${(50 - zoomY) * scale}%) scale(${scale})`

  const clampPan = (v: number) => Math.max(-110, Math.min(110, v))

  const onPanStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!zoomed) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) > 6) {
      d.moved = true
      setDragging(true)
    }
    if (d.moved) setPan({ x: clampPan(d.px + dx), y: clampPan(d.py + dy) })
  }
  const onPanEnd = () => {
    const d = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (d && !d.moved) setZoomedId(null) // plain click → zoom out
  }

  // changes when fresh data arrives — re-keys overlays so the glow-in replays
  const dataStamp = `${date ?? ''}:${markers?.length ?? 0}`

  /**
   * Bulletproof image box: the stage is measured with a ResizeObserver and the
   * hologram box is derived with pure ratio math. CSS `aspect-ratio` + `h-full`
   * + `max-w-full` can break the ratio (width clamped, height not) and letterbox
   * the image — which made every dot sit above its organ. This cannot letterbox.
   */
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setStage({ w: r.width, h: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const IMG_RATIO = 1024 / 1435
  let boxW = 0
  let boxH = 0
  if (stage && stage.w > 0 && stage.h > 0) {
    boxH = stage.h
    boxW = boxH * IMG_RATIO
    if (boxW > stage.w) {
      boxW = stage.w
      boxH = boxW / IMG_RATIO
    }
  }

  // 3D tilt: the hologram leans toward the mouse (fine pointers only, not while zoomed)
  const canTilt = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 })
  const onTiltMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canTilt || zoomed) return
    const r = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width - 0.5
    const ny = (e.clientY - r.top) / r.height - 0.5
    setTilt({ rx: -ny * 7, ry: nx * 10 })
  }
  const onTiltLeave = () => setTilt({ rx: 0, ry: 0 })

  // floating card anchor: side opposite the screen edge, clamped inside the panel
  const cardLeft = zoomed ? (zoomed.def.dot.x <= 50 ? 2 : undefined) : undefined
  const cardRight = zoomed ? (zoomed.def.dot.x > 50 ? 2 : undefined) : undefined
  const cardTop = zoomed ? Math.min(Math.max(zoomed.def.dot.y - 12, 3), 52) : 0

  return (
    <div className="flex w-full flex-col items-center gap-2 lg:h-full lg:justify-center">
      <div
        ref={stageRef}
        className="relative flex h-[340px] w-full items-center justify-center sm:h-[380px] lg:h-full"
        style={{ perspective: '1100px' }}
        onPointerMove={onTiltMove}
        onPointerLeave={onTiltLeave}
      >
        {/* soft radial glow */}
        <div
          className="absolute inset-0 -z-0"
          style={{ background: 'radial-gradient(closest-side, rgba(34,211,238,0.16), rgba(34,211,238,0.05) 55%, transparent 75%)' }}
          aria-hidden="true"
        />
        {/* reticle rings behind the body (fade during zoom) */}
        <Reticle className={cn('absolute h-[118%] w-auto transition-opacity duration-500', zoomed ? 'opacity-15' : 'opacity-70')} />
        <Reticle className={cn('absolute top-[16%] h-[46%] w-auto transition-opacity duration-500', zoomed ? 'opacity-10' : 'opacity-50')} />

        {/* hologram + hotspot container — sized by ratio math, never letterboxed */}
        {boxW > 0 && (
        <div
          className="relative transition-transform duration-300 ease-out"
          style={{
            width: boxW,
            height: boxH,
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
            transformStyle: 'preserve-3d',
          }}
        >
          {/* float wrapper: img + glows + dots ride the breathing motion TOGETHER,
              so hotspots stay anchored to the organs (was: img floated alone) */}
          <div className={cn('h-full w-full', !empty && 'hud-float')}>
            {/* zooming wrapper — transform origin stays centred; translate targets the organ */}
            <div
              className={cn('hud-zoom h-full w-full', dragging && 'transition-none')}
              style={{ transform }}
            >
              <img
                src="./body-hologram.png"
                alt="Holographic human body scan"
                className="h-full w-full select-none object-contain"
                style={{
                  filter: empty
                    ? 'grayscale(0.55) brightness(0.45) saturate(0.7)'
                    : 'drop-shadow(0 0 22px rgba(34,211,238,0.35))',
                }}
                draggable={false}
              />

            {/* horizontal scanline sweep */}
            {!empty && !zoomed && (
              <div className="hud-scanline pointer-events-none absolute inset-x-[8%] h-10" aria-hidden="true" />
            )}

            {/* organ glow overlays (only regions that have markers) */}
            {!empty &&
              regions.map((r) => {
                if (r.markers.length === 0) return null
                const color = FLAG_COLOR[r.worst]
                const boost = zoomedId === r.def.id ? 0.3 : 0
                if (r.def.id === 'systemic') {
                  return VESSEL_STREAKS.map((s, i) => (
                    <GlowLayer
                      key={`vessel-${i}-${dataStamp}`}
                      shape={s}
                      color={color}
                      intensity={r.intensity * 0.7 + boost}
                      delay={i * 0.55} // staggered — reads as flowing blood
                      capsule
                    />
                  ))
                }
                return r.def.shapes.map((s, i) => (
                  <GlowLayer
                    key={`${r.def.id}-${i}-${dataStamp}`}
                    shape={s}
                    color={color}
                    intensity={Math.min(1, r.intensity + boost)}
                  />
                ))
              })}

            {/* empty state overlay */}
            {empty && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                <span className="hud-mono rounded-sm border border-cyan-400/30 bg-[#020817]/80 px-3 py-2 text-[11px] tracking-[0.18em] text-cyan-200/80 shadow-[0_0_18px_rgba(34,211,238,0.2)]">
                  BODY MAP OFFLINE
                </span>
                <span className="hud-mono text-[10px] tracking-wider text-cyan-100/45">
                  Upload a test to activate the body map
                </span>
              </div>
            )}

            {/* interactive anchor dots + label chips — every region always renders,
                no-data regions show a dim placeholder dot that still opens the card */}
            {!empty &&
              regions.map((r) => {
                const noData = r.markers.length === 0
                const color = FLAG_COLOR[r.worst]
                const active = selectedRegion === r.def.id || zoomedId === r.def.id
                const dimmed = zoomed !== null && zoomedId !== r.def.id
                return (
                  <button
                    key={r.def.id}
                    onClick={() => setZoomedId((cur) => (cur === r.def.id ? null : r.def.id))}
                    title={
                      noData
                        ? `${r.def.title} — no markers in the latest test; click for info`
                        : `${r.label} — click to zoom in`
                    }
                    disabled={dimmed}
                    className={cn(
                      'group absolute -translate-x-1/2 -translate-y-1/2 rounded-full outline-none transition-opacity duration-300 focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
                      dimmed && 'pointer-events-none opacity-0',
                    )}
                    style={{ left: `${r.def.dot.x}%`, top: `${r.def.dot.y}%` }}
                  >
                    {/* pulsing dot */}
                    <span className={cn('relative block h-3 w-3', noData && 'opacity-45')}>
                      {!noData && (
                        <span
                          className="hud-ping absolute inset-0 rounded-full"
                          style={{ border: `1.5px solid ${color}` }}
                        />
                      )}
                      <span
                        className={cn(
                          'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform group-hover:scale-125',
                          noData ? 'h-[5px] w-[5px] border bg-transparent' : 'h-[7px] w-[7px]',
                        )}
                        style={
                          noData
                            ? { borderColor: `${color}AA` }
                            : { background: color, boxShadow: `0 0 8px ${color}, 0 0 3px ${color}` }
                        }
                      />
                      {active && (
                        <span
                          className="absolute -inset-1.5 rounded-full border"
                          style={{ borderColor: `${color}99` }}
                        />
                      )}
                    </span>
                    {/* label chip */}
                    <span
                      className={cn(
                        'hud-mono pointer-events-none absolute whitespace-nowrap rounded-sm border px-1.5 py-px text-[9px] tracking-wider transition-opacity',
                        zoomed && 'opacity-0',
                        noData && 'opacity-40',
                        r.def.chipSide === 'below' && 'left-1/2 top-full mt-1.5 -translate-x-1/2',
                        r.def.chipSide === 'above' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
                        r.def.chipSide === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2',
                        r.def.chipSide === 'left' && 'right-full top-1/2 mr-2 -translate-y-1/2',
                      )}
                      style={{
                        color,
                        borderColor: `${color}55`,
                        background: 'rgba(2,8,23,0.82)',
                        boxShadow: `0 0 10px ${color}30`,
                      }}
                    >
                      {r.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* backdrop: click to zoom out, drag to pan the zoomed view */}
          {zoomed && isLg && (
            <div
              className={cn('absolute inset-0 z-10', dragging ? 'cursor-grabbing' : 'cursor-grab')}
              onPointerDown={onPanStart}
              onPointerMove={onPanMove}
              onPointerUp={onPanEnd}
              onPointerCancel={onPanEnd}
              role="button"
              aria-label="Zoom out (click) or pan (drag)"
              tabIndex={-1}
            />
          )}

          {/* floating info card anchored next to the organ (desktop) */}
          {zoomed && isLg && (
            <>
              {/* connector line from the card to the centred zoom target */}
              <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full" aria-hidden="true">
                <line
                  x1={`${zoomed.def.dot.x <= 50 ? Math.max(zoomed.def.dot.x, 24) : Math.min(zoomed.def.dot.x, 76)}%`}
                  y1={`${cardTop + 8}%`}
                  x2="50%"
                  y2="50%"
                  stroke={FLAG_COLOR[zoomed.worst]}
                  strokeOpacity="0.55"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              </svg>
              <div
                className="absolute z-30 w-60 max-w-[68%]"
                style={{
                  left: cardLeft != null ? `${cardLeft}%` : undefined,
                  right: cardRight != null ? `${cardRight}%` : undefined,
                  top: `${cardTop}%`,
                }}
              >
                <OrganInfo
                  region={zoomed}
                  date={date}
                  onClose={() => setZoomedId(null)}
                  onSelectMarker={onSelectMarker}
                />
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {/* mobile: card docks below the hologram instead of floating */}
      {zoomed && !isLg && (
        <div className="w-full">
          <OrganInfo
            region={zoomed}
            date={date}
            onClose={() => setZoomedId(null)}
            onSelectMarker={onSelectMarker}
          />
        </div>
      )}

      {!empty && !zoomed && (
        <p className="hud-mono text-center text-[9px] tracking-[0.2em] text-cyan-100/35">
          TAP A GLOWING ORGAN TO ZOOM IN · ESC TO ZOOM OUT
        </p>
      )}
    </div>
  )
}
