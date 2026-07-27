import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { BiomarkerReading } from '@/types/biomarker'
import { explainMarker, ApiError } from '@/lib/api'
import { createAiCache } from '@/lib/aiCache'

const cache = createAiCache('vitals-hud-marker-v1', 100)

type State =
  | { kind: 'loading' }
  | { kind: 'text'; text: string }
  | { kind: 'no-key' }
  | { kind: 'error'; message: string }

/** Inline "what does this value mean" mini-card shown under a results-table row. */
export function MarkerMeaning({ marker }: { marker: BiomarkerReading }) {
  const key = `marker|${marker.name.toLowerCase()}:${marker.value}:${marker.flag}`
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async () => {
    const cached = cache.get(key)
    if (cached) {
      setState({ kind: 'text', text: cached })
      return
    }
    setState({ kind: 'loading' })
    try {
      const text = await explainMarker({
        name: marker.name,
        value: marker.value,
        unit: marker.unit,
        refLow: marker.refLow,
        refHigh: marker.refHigh,
        flag: marker.flag,
        category: marker.category,
      })
      cache.set(key, text)
      setState({ kind: 'text', text })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_API_KEY') {
        setState({ kind: 'no-key' })
        return
      }
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [key, marker])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="border-t border-fuchsia-400/15 bg-fuchsia-950/10 px-3 py-2">
      {state.kind === 'loading' && (
        <p className="hud-mono flex items-center gap-2 py-1 text-[10px] tracking-wider text-fuchsia-300">
          <Loader2 className="h-3 w-3 animate-spin" /> Asking AI what this value means…
        </p>
      )}
      {state.kind === 'text' && (
        <p className="text-[12px] leading-relaxed text-cyan-100/85">{state.text}</p>
      )}
      {state.kind === 'no-key' && (
        <p className="text-[11px] text-cyan-100/50">
          Add an API key in AI settings to get per-marker explanations.
        </p>
      )}
      {state.kind === 'error' && (
        <div className="flex items-start gap-2">
          <p className="flex-1 text-[11px] text-amber-300/90">{state.message}</p>
          <button
            onClick={() => void load()}
            className="hud-mono flex shrink-0 items-center gap-1 rounded-sm border border-cyan-400/30 px-1.5 py-0.5 text-[9px] tracking-wider text-cyan-200/90 transition hover:bg-cyan-400/10"
          >
            <RefreshCw className="h-2.5 w-2.5" /> RETRY
          </button>
        </div>
      )}
    </div>
  )
}
