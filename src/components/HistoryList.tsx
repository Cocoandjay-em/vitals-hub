import { FlaskConical } from 'lucide-react'
import type { TestRecord } from '@/types/biomarker'
import { cn } from '@/lib/utils'

interface HistoryListProps {
  records: TestRecord[]
  activeDate: string | null
  onPick: (date: string) => void
}

export function HistoryList({ records, activeDate, onPick }: HistoryListProps) {
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <div className="hud-scroll max-h-72 space-y-1.5 overflow-y-auto pr-1">
      {sorted.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.date)}
          className={cn(
            'hud-row flex w-full items-center gap-3 rounded-sm border border-cyan-400/10 bg-[#020817]/50 px-3 py-2 text-left',
            activeDate === t.date && 'hud-row-selected',
          )}
        >
          <FlaskConical className="h-3.5 w-3.5 shrink-0 text-cyan-400/70" />
          <span className="hud-mono text-xs font-semibold text-cyan-100">{t.date}</span>
          <span className="hud-mono text-[10px] text-cyan-100/45">{t.markers.length} markers</span>
          {t.demo && (
            <span className="hud-mono rounded-sm border border-fuchsia-400/40 bg-fuchsia-400/10 px-1 text-[9px] tracking-wider text-fuchsia-300">
              DEMO DATA
            </span>
          )}
          <span className="hud-mono ml-auto truncate pl-2 text-[10px] text-cyan-100/35">
            {t.sources.join(' · ')}
          </span>
        </button>
      ))}
      {sorted.length === 0 && (
        <p className="hud-mono py-6 text-center text-[11px] text-cyan-100/40">No tests recorded yet.</p>
      )}
    </div>
  )
}
