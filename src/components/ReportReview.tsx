import { useState } from 'react'
import { Check, FileText, Trash2 } from 'lucide-react'
import type { RegionId } from '@/lib/regions'
import { REGIONS } from '@/lib/regions'
import { STAGE_COLOR, STAGE_LABEL, STAGES, type ReportAnalysis, type Stage } from '@/types/report'

/**
 * Review step for a clinical report: the AI proposes a visit date, an organ
 * region and a severity stage; nothing is stored until the user confirms.
 * Every proposed field stays editable — the AI drafts, the user decides.
 */

export interface ReportDraft extends ReportAnalysis {
  /** original document, kept so it can be stored with the record */
  fileBase64?: string
  mime?: string
}

interface ReportReviewProps {
  drafts: ReportDraft[]
  onConfirm: (index: number, edited: ReportDraft) => void
  onDiscard: (index: number) => void
  busy?: boolean
}

export function ReportReview({ drafts, onConfirm, onDiscard, busy }: ReportReviewProps) {
  return (
    <div className="flex flex-col gap-3">
      {drafts.map((draft, i) => (
        <DraftCard
          key={`${draft.fileName}-${i}`}
          draft={draft}
          busy={busy}
          onConfirm={(edited) => onConfirm(i, edited)}
          onDiscard={() => onDiscard(i)}
        />
      ))}
    </div>
  )
}

function DraftCard({
  draft,
  onConfirm,
  onDiscard,
  busy,
}: {
  draft: ReportDraft
  onConfirm: (edited: ReportDraft) => void
  onDiscard: () => void
  busy?: boolean
}) {
  const [date, setDate] = useState(draft.date ?? new Date().toISOString().slice(0, 10))
  const [region, setRegion] = useState<RegionId>(draft.region)
  const [stage, setStage] = useState<Stage>(draft.stage)
  const [title, setTitle] = useState(draft.title)

  const failed = !!draft.error
  const color = STAGE_COLOR[stage]
  // a changed stage becomes the user's own call, not the model's
  const stageSource: 'ai' | 'user' = stage === draft.stage ? 'ai' : 'user'

  if (failed) {
    return (
      <div className="rounded-sm border border-rose-400/40 bg-rose-400/5 px-3 py-2.5">
        <p className="hud-mono flex items-center gap-1.5 text-[10px] tracking-wider text-rose-300">
          <FileText className="h-3 w-3" /> {draft.fileName}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-rose-200/80">{draft.error}</p>
        <button
          onClick={onDiscard}
          className="hud-mono mt-2 flex items-center gap-1 rounded-sm border border-rose-400/40 px-2 py-1 text-[9px] tracking-wider text-rose-300/90 transition hover:bg-rose-400/10"
        >
          <Trash2 className="h-3 w-3" /> DISMISS
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-sm border bg-[#020817]/60" style={{ borderColor: `${color}44` }}>
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: `${color}22` }}>
        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        <p className="hud-mono min-w-0 flex-1 truncate text-[10px] tracking-wider text-cyan-100/70">
          {draft.fileName}
        </p>
        <span
          className="hud-mono shrink-0 rounded-sm border px-1 py-px text-[8px] tracking-wider"
          style={{ color, borderColor: `${color}55` }}
        >
          AI PROPOSAL
        </span>
      </div>

      <div className="flex flex-col gap-2.5 px-3 py-2.5">
        <label className="flex flex-col gap-1">
          <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">TITLE</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1 text-[11px] text-cyan-100 outline-none focus:border-cyan-400/60"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">VISIT DATE</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1 text-[11px] text-cyan-100 outline-none focus:border-cyan-400/60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">ATTACH TO</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as RegionId)}
              className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1 text-[11px] text-cyan-100 outline-none focus:border-cyan-400/60"
            >
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* the staging the user is asked to check */}
        <div className="flex flex-col gap-1">
          <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">
            CRITICALITY STAGE {stageSource === 'user' && <span className="text-amber-300/70">· OVERRIDDEN</span>}
          </span>
          <div className="flex flex-wrap gap-1">
            {STAGES.map((s) => {
              const active = s === stage
              const c = STAGE_COLOR[s]
              return (
                <button
                  key={s}
                  onClick={() => setStage(s)}
                  className="hud-mono rounded-sm border px-1.5 py-0.5 text-[9px] tracking-wider transition"
                  style={{
                    color: active ? c : 'rgba(207,250,254,0.45)',
                    borderColor: active ? `${c}88` : 'rgba(34,211,238,0.2)',
                    background: active ? `${c}18` : 'transparent',
                  }}
                  title={s === draft.stage ? 'Proposed by the AI' : `Override to ${STAGE_LABEL[s]}`}
                >
                  {STAGE_LABEL[s]}
                  {s === draft.stage ? ' ◂AI' : ''}
                </button>
              )
            })}
          </div>
          {draft.stageRationale && (
            <p className="hud-mono mt-0.5 text-[9px] leading-relaxed tracking-wider text-cyan-100/35">
              WHY · {draft.stageRationale}
            </p>
          )}
        </div>

        {draft.summary && (
          <p className="text-[11px] leading-relaxed text-cyan-100/80">{draft.summary}</p>
        )}

        {draft.findings.length > 0 && (
          <ul className="flex flex-col gap-1">
            {draft.findings.map((f, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-cyan-100/65">
                <span style={{ color }}>·</span>
                <span className="min-w-0 flex-1">{f}</span>
              </li>
            ))}
          </ul>
        )}

        {draft.followUp && (
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            <span className="hud-mono text-[9px] tracking-wider text-amber-300/70">FOLLOW-UP · </span>
            {draft.followUp}
          </p>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={() => onConfirm({ ...draft, date, region, stage, title })}
            disabled={busy}
            className="hud-mono flex items-center gap-1 rounded-sm border border-emerald-400/40 px-2 py-1 text-[10px] tracking-wider text-emerald-300/90 transition hover:bg-emerald-400/10 disabled:opacity-40"
          >
            <Check className="h-3 w-3" /> ATTACH TO BODY MAP
          </button>
          <button
            onClick={onDiscard}
            disabled={busy}
            className="hud-mono flex items-center gap-1 rounded-sm border border-rose-400/30 px-2 py-1 text-[10px] tracking-wider text-rose-300/80 transition hover:bg-rose-400/10 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" /> DISCARD
          </button>
          <span className="hud-mono ml-auto text-[8px] tracking-[0.14em] text-cyan-100/25">
            NOT A DIAGNOSIS
          </span>
        </div>
      </div>
    </div>
  )
}
