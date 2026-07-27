import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Settings, Sparkles, X } from 'lucide-react'
import type { TestRecord } from '@/types/biomarker'
import { analyzePanel, ApiError } from '@/lib/api'
import { createAiCache, markersHash } from '@/lib/aiCache'

const cache = createAiCache('vitals-hud-analysis-v2')

interface PanelAnalysisProps {
  record: TestRecord
  onClose: () => void
  onOpenSettings: () => void
}

type AnalysisState =
  | { kind: 'loading' }
  | { kind: 'text'; text: string; cached: boolean }
  | { kind: 'no-key' }
  | { kind: 'error'; message: string }

/** Render markdown-lite: generic summary always visible, specifics behind a toggle. */
function AnalysisText({ text }: { text: string }) {
  const [showDetails, setShowDetails] = useState(false)
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const paragraphs: string[] = []
  const bullets: string[] = []
  for (const line of lines) {
    if (line.startsWith('- ')) bullets.push(line.slice(2))
    else if (bullets.length === 0) paragraphs.push(line)
    else bullets.push(line.replace(/^[-•*]\s*/, '')) // tolerate other bullet chars
  }
  return (
    <div className="flex flex-col gap-2">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-[12.5px] leading-relaxed text-cyan-100/90">{p}</p>
      ))}
      {bullets.length > 0 && (
        <div>
          <button
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="hud-mono flex items-center gap-1 rounded-sm border border-fuchsia-400/30 px-2 py-1 text-[9.5px] tracking-wider text-fuchsia-200/90 transition hover:bg-fuchsia-400/10"
          >
            {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showDetails ? 'HIDE DETAILS' : `DETAILS · ${bullets.length} THEMES`}
          </button>
          {showDetails && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-cyan-100/80">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fuchsia-300/80" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Full-panel AI analysis card shown above the results table. */
export function PanelAnalysis({ record, onClose, onOpenSettings }: PanelAnalysisProps) {
  const key = useMemo(() => markersHash('panel', record.date, record.markers), [record])
  const [state, setState] = useState<AnalysisState>({ kind: 'loading' })

  const load = useCallback(async () => {
    const cached = cache.get(key)
    if (cached) {
      setState({ kind: 'text', text: cached, cached: true })
      return
    }
    setState({ kind: 'loading' })
    try {
      const text = await analyzePanel({
        date: record.date,
        markers: record.markers.map((m) => ({
          name: m.name,
          value: m.value,
          unit: m.unit,
          refLow: m.refLow,
          refHigh: m.refHigh,
          flag: m.flag,
          category: m.category,
        })),
      })
      cache.set(key, text)
      setState({ kind: 'text', text, cached: false })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_API_KEY') {
        setState({ kind: 'no-key' })
        return
      }
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [key, record])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="rounded-sm border border-fuchsia-400/30 bg-fuchsia-950/15 p-3 shadow-[0_0_24px_rgba(232,121,249,0.08)]">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" />
        <h3 className="hud-mono text-[11px] font-semibold tracking-[0.16em] text-fuchsia-200">
          AI PANEL ANALYSIS
        </h3>
        <span className="hud-mono text-[9px] tracking-wider text-cyan-100/40">
          {record.markers.length} MARKERS · {record.date}
          {state.kind === 'text' && state.cached ? ' · CACHED' : ''}
        </span>
        <button
          onClick={onClose}
          className="ml-auto rounded-sm p-1 text-slate-400 transition hover:bg-cyan-400/10 hover:text-cyan-200"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {state.kind === 'loading' && (
        <p className="hud-mono flex items-center gap-2 py-2 text-[11px] tracking-wider text-fuchsia-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing full panel…
        </p>
      )}

      {state.kind === 'text' && <AnalysisText text={state.text} />}

      {state.kind === 'no-key' && (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[12px] leading-relaxed text-cyan-100/70">
            AI analysis needs an API key for an OpenAI-compatible model.
          </p>
          <button
            onClick={onOpenSettings}
            className="hud-mono flex shrink-0 items-center gap-1 rounded-sm border border-fuchsia-400/40 bg-fuchsia-400/10 px-2.5 py-1 text-[10px] tracking-wider text-fuchsia-200 transition hover:bg-fuchsia-400/20"
          >
            <Settings className="h-3 w-3" /> OPEN AI SETTINGS
          </button>
        </div>
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
  )
}
