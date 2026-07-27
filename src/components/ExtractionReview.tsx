import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, FileText, TriangleAlert } from 'lucide-react'
import type { ExtractionResult } from '@/types/biomarker'
import { FlagBadge } from '@/components/RangeBar'

interface ExtractionReviewProps {
  results: ExtractionResult[]
  onConfirm: (index: number, date?: string) => void
  onDiscard: (index: number) => void
}

const METHOD_LABEL: Record<ExtractionResult['method'], string> = {
  'pdf-text': 'PDF text layer (offline)',
  'pdf-ocr': 'Scanned PDF → OCR (offline)',
  ocr: 'Image OCR (offline)',
  ai: 'AI vision extraction',
  none: '—',
}

/** Per-file extraction summary with editable date, confirm / discard and raw-text collapsible. */
export function ExtractionReview({ results, onConfirm, onDiscard }: ExtractionReviewProps) {
  const [openRaw, setOpenRaw] = useState<Set<number>>(new Set())
  /** per-file date overrides keyed by result index (falls back to detected date) */
  const [dateEdits, setDateEdits] = useState<Record<number, string>>({})

  const toggleRaw = (i: number) => {
    setOpenRaw((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {results.map((r, i) => {
        const effectiveDate = dateEdits[i] ?? r.date ?? ''
        return (
          <div key={`${r.fileName}-${i}`} className="rounded-sm border border-cyan-400/15 bg-cyan-950/20 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <FileText className="h-4 w-4 shrink-0 text-cyan-300" />
              <span className="hud-mono text-xs font-semibold text-cyan-50">{r.fileName}</span>
              <span className="hud-mono text-[10px] text-cyan-100/40">{METHOD_LABEL[r.method]}</span>
              <span className="hud-mono text-[10px] text-cyan-200/70">
                {r.ok ? `${r.rows.length} markers` : 'no markers parsed'}
              </span>
              {r.ok && (
                <label className="flex items-center gap-1.5" title="Detected test date — edit before confirming">
                  <span className="hud-label">Date</span>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setDateEdits((prev) => ({ ...prev, [i]: e.target.value }))}
                    className="hud-mono rounded-sm border border-cyan-400/25 bg-[#020817]/80 px-1.5 py-0.5 text-[11px] text-cyan-100 outline-none [color-scheme:dark] focus:border-cyan-300/60"
                  />
                </label>
              )}
              {r.ok && r.rows.some((row) => row.refLow === null && row.refHigh === null) && (
                <span className="hud-mono rounded-sm border border-amber-400/40 bg-amber-400/10 px-1.5 py-px text-[10px] tracking-wider text-amber-300">
                  {r.rows.filter((row) => row.refLow === null && row.refHigh === null).length} WITHOUT RANGE
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {r.ok && (
                  <>
                    <button
                      onClick={() => onConfirm(i, effectiveDate || undefined)}
                      disabled={!effectiveDate}
                      className="hud-mono flex items-center gap-1 rounded-sm border border-emerald-400/50 bg-emerald-400/10 px-2.5 py-1 text-[11px] tracking-wider text-emerald-300 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Check className="h-3 w-3" /> ADD TO HISTORY
                    </button>
                    <button
                      onClick={() => onDiscard(i)}
                      className="hud-mono rounded-sm border border-slate-500/40 px-2.5 py-1 text-[11px] tracking-wider text-slate-400 transition hover:bg-slate-500/10"
                    >
                      DISCARD
                    </button>
                  </>
                )}
                {!r.ok && (
                  <button
                    onClick={() => onDiscard(i)}
                    className="hud-mono rounded-sm border border-slate-500/40 px-2.5 py-1 text-[11px] tracking-wider text-slate-400 transition hover:bg-slate-500/10"
                  >
                    DISMISS
                  </button>
                )}
              </div>
            </div>

            {r.error && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/90">
                <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {r.error}
              </p>
            )}

            {r.ok && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.rows.slice(0, 14).map((row) => (
                  <span key={row.name} className="hud-mono flex items-center gap-1 rounded-sm border border-cyan-400/15 bg-[#020817]/60 px-1.5 py-0.5 text-[10px] text-cyan-100/80">
                    {row.name} <b>{row.value}</b> {row.unit} <FlagBadge flag={row.flag} />
                    {row.refLow === null && row.refHigh === null && (
                      <span className="rounded-sm border border-amber-400/50 bg-amber-400/10 px-1 text-[9px] tracking-wider text-amber-300">
                        NO RANGE
                      </span>
                    )}
                  </span>
                ))}
                {r.rows.length > 14 && (
                  <span className="hud-mono px-1 py-0.5 text-[10px] text-cyan-100/40">+{r.rows.length - 14} more</span>
                )}
              </div>
            )}

            {r.rawText && (
              <div className="mt-2">
                <button onClick={() => toggleRaw(i)} className="hud-mono flex items-center gap-1 text-[10px] tracking-wider text-cyan-400/70 hover:text-cyan-300">
                  {openRaw.has(i) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  RAW EXTRACTED TEXT
                </button>
                {openRaw.has(i) && (
                  <pre className="hud-scroll mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-sm border border-cyan-400/10 bg-[#020817]/80 p-2 text-[10px] leading-relaxed text-cyan-100/60">
                    {r.rawText}
                  </pre>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
