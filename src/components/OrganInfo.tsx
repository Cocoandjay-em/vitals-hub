import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import type { RegionId, RegionState } from '@/components/BodyMap'
import { FLAG_COLOR } from '@/components/BodyMap'
import { FlagBadge } from '@/components/RangeBar'
import { explain, ApiError } from '@/lib/api'
import { createAiCache, markersHash } from '@/lib/aiCache'

const cache = createAiCache('vitals-hud-explain-v1')

/* --------------------------- offline fallback ---------------------------- */

const REGION_FALLBACK: Record<RegionId, string> = {
  neck: 'The thyroid is a small gland in the neck whose hormones set the pace of the metabolism — energy, weight, temperature and heart rate all follow its signal.',
  heart: 'Lipid markers describe the fats circulating in the blood. Over time, an unfavourable balance is associated with fatty deposits in artery walls, which is why these markers are tracked as long-term cardiovascular risk indicators.',
  lungs: 'Inflammation markers rise whenever the immune system is active — from a passing infection to longer-lasting inflammatory processes. A single elevated value is common and often temporary; the trend matters more than one reading.',
  liver: 'The liver filters the blood, processes nutrients and medications, and produces essential proteins. Its enzyme markers rise when liver cells are stressed — by alcohol, medications, fatty-liver changes or infections.',
  gut: 'Glucose and metabolic markers show how the body manages blood sugar and energy. Persistently elevated values suggest the body is responding less effectively to insulin.',
  kidney: 'The kidneys filter waste from the blood and balance fluids and minerals. Their markers estimate how well that filtration is working; values outside range are worth rechecking, especially if they persist.',
  systemic: 'Blood-count markers describe the red cells, white cells and platelets that carry oxygen, defend against infection and stop bleeding. Vitamin and mineral levels reflect nutritional reserves.',
}

function fallbackText(region: RegionState): string {
  const parts = region.markers.map((m) => {
    const range =
      m.refLow != null || m.refHigh != null ? ` (reference ${m.refLow ?? '–'} – ${m.refHigh ?? '–'})` : ''
    const state = m.flag === 'normal' ? 'in range' : m.flag === 'unknown' ? 'no flag' : m.flag
    return `${m.name} is ${m.value}${m.unit ? ` ${m.unit}` : ''}${range}, ${state}`
  })
  return `${REGION_FALLBACK[region.def.id]} In this test: ${parts.join('; ')}. Reference ranges vary between labs — discuss anything persistent or concerning with your doctor.`
}

/** Static description for regions with no markers in the latest test — no AI call. */
function staticText(region: RegionState): string {
  return `${REGION_FALLBACK[region.def.id]} No markers for this organ system in the latest test — upload a report that covers it to see values, flags and AI insights here.`
}

/* ------------------------------- component ------------------------------- */

interface OrganInfoProps {
  region: RegionState
  date?: string
  onClose: () => void
  onSelectMarker: (name: string) => void
}

type ExplState =
  | { kind: 'loading' }
  | { kind: 'text'; text: string; cached: boolean }
  | { kind: 'fallback'; text: string }
  | { kind: 'error'; message: string }

/** HUD card with the region's markers and an AI plain-language explanation. */
export function OrganInfo({ region, date, onClose, onSelectMarker }: OrganInfoProps) {
  const color = FLAG_COLOR[region.worst]
  const key = useMemo(() => markersHash(region.def.id, date, region.markers), [region, date])
  const [state, setState] = useState<ExplState>({ kind: 'loading' })

  const load = useCallback(async () => {
    // empty region: static organ description, no AI call needed
    if (region.markers.length === 0) {
      setState({ kind: 'fallback', text: staticText(region) })
      return
    }
    const cached = cache.get(key)
    if (cached) {
      setState({ kind: 'text', text: cached, cached: true })
      return
    }
    setState({ kind: 'loading' })
    try {
      const text = await explain({
        region: region.def.id,
        date,
        markers: region.markers.map((m) => ({
          name: m.name,
          value: m.value,
          unit: m.unit,
          refLow: m.refLow,
          refHigh: m.refHigh,
          flag: m.flag,
        })),
      })
      cache.set(key, text)
      setState({ kind: 'text', text, cached: false })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_API_KEY') {
        setState({ kind: 'fallback', text: fallbackText(region) })
        return
      }
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [key, region, date])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div
      className="rounded-sm border bg-[#020817]/90 backdrop-blur-sm"
      style={{ borderColor: `${color}44`, boxShadow: `0 0 24px ${color}18` }}
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: `${color}22` }}>
        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        <h3 className="hud-mono text-[11px] font-semibold tracking-[0.16em] text-cyan-50">
          {region.def.title.toUpperCase()}
        </h3>
        <span className="hud-mono text-[9px] tracking-wider text-cyan-100/40">
          {region.markers.length === 0
            ? 'NO MARKERS IN LATEST TEST'
            : `${region.markers.length} MARKER${region.markers.length === 1 ? '' : 'S'}`}
          {date && region.markers.length > 0 ? ` · ${date}` : ''}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded-sm p-1 text-slate-400 transition hover:bg-cyan-400/10 hover:text-cyan-200"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* markers */}
      <div className="flex flex-col gap-px px-3 py-2">
        {region.markers.map((m) => (
          <button
            key={m.name}
            onClick={() => onSelectMarker(m.name)}
            title="View trend"
            className="flex items-center gap-2 rounded-sm px-1 py-1 text-left transition hover:bg-cyan-400/8"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] text-cyan-100">{m.name}</span>
            <span className="hud-mono shrink-0 text-[11px] text-cyan-100/80">
              <b>{m.value}</b> <span className="text-[9px] text-cyan-100/50">{m.unit}</span>
            </span>
            <FlagBadge flag={m.flag} />
          </button>
        ))}
      </div>

      {/* AI explanation */}
      <div className="border-t px-3 py-2.5" style={{ borderColor: `${color}22` }}>
        <p className="hud-mono mb-1.5 flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-fuchsia-300/80">
          <Sparkles className="h-3 w-3" />
          {region.markers.length === 0 ? 'ABOUT THIS ORGAN' : 'AI INSIGHT'}
          {state.kind === 'text' && state.cached && (
            <span className="text-cyan-100/30">· CACHED</span>
          )}
        </p>

        {state.kind === 'loading' && (
          <p className="hud-mono flex items-center gap-2 py-2 text-[11px] tracking-wider text-cyan-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consulting AI…
          </p>
        )}

        {(state.kind === 'text' || state.kind === 'fallback') && (
          <p className="text-[12px] leading-relaxed text-cyan-100/85">{state.text}</p>
        )}

        {state.kind === 'fallback' && (
          <p className="hud-mono mt-1.5 text-[9px] tracking-wider text-cyan-100/35">
            {region.markers.length === 0
              ? 'STATIC DESCRIPTION · no AI call needed'
              : 'OFFLINE SUMMARY · add an API key in AI settings for live explanations'}
          </p>
        )}

        {state.kind === 'error' && (
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[11px] leading-relaxed text-amber-300/90">{state.message}</p>
            <button
              onClick={() => void load()}
              className="hud-mono flex shrink-0 items-center gap-1 rounded-sm border border-cyan-400/30 px-2 py-1 text-[9px] tracking-wider text-cyan-200/90 transition hover:bg-cyan-400/10"
            >
              <RefreshCw className="h-3 w-3" /> RETRY
            </button>
          </div>
        )}

        <p className="hud-mono mt-2 text-[8px] tracking-[0.14em] text-cyan-100/25">
          NOT MEDICAL ADVICE · ALWAYS DISCUSS RESULTS WITH YOUR DOCTOR
        </p>
      </div>
    </div>
  )
}
