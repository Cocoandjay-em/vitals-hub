import { Fragment, useState } from 'react'
import { Info, X } from 'lucide-react'
import type { BiomarkerReading } from '@/types/biomarker'
import { FlagBadge, RangeBar } from '@/components/RangeBar'
import { MarkerMeaning } from '@/components/MarkerMeaning'
import { cn } from '@/lib/utils'

interface ResultsTableProps {
  markers: BiomarkerReading[]
  selected: string | null
  onSelect: (name: string) => void
  onDelete?: (name: string) => void
}

const FLAG_ORDER = { high: 0, low: 0, unknown: 1, normal: 2 } as const

/** Latest-test results table; out-of-range rows sort first. */
export function ResultsTable({ markers, selected, onSelect, onDelete }: ResultsTableProps) {
  const sorted = [...markers].sort(
    (a, b) => FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag] || a.name.localeCompare(b.name),
  )
  /** row with the AI-meaning mini-card expanded */
  const [meaningFor, setMeaningFor] = useState<string | null>(null)
  const colCount = onDelete ? 7 : 6

  return (
    <div className="hud-scroll overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="border-b border-cyan-400/20 text-left">
            <th className="hud-label px-2 py-2 font-normal">Biomarker</th>
            <th className="hud-label px-2 py-2 font-normal">Category</th>
            <th className="hud-label px-2 py-2 font-normal text-right">Value</th>
            <th className="hud-label w-[34%] px-2 py-2 font-normal">Reference range</th>
            <th className="hud-label px-2 py-2 font-normal">Flag</th>
            <th className="w-8" />
            {onDelete && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <Fragment key={m.name}>
              <tr
                onClick={() => onSelect(m.name)}
                className={cn('hud-row group border-b border-cyan-400/8', selected === m.name && 'hud-row-selected')}
                title="Click to view trend"
              >
                <td className="px-2 py-2.5 text-[13px] font-medium text-cyan-50">{m.name}</td>
                <td className="px-2 py-2.5">
                  <span className="hud-mono text-[10px] tracking-wider text-fuchsia-300/70">{m.category.toUpperCase()}</span>
                </td>
                <td className="hud-mono px-2 py-2.5 text-right text-[13px] text-cyan-100">
                  <b>{m.value}</b> <span className="text-[10px] text-cyan-100/50">{m.unit}</span>
                </td>
                <td className="px-2 py-2.5">
                  <RangeBar value={m.value} refLow={m.refLow} refHigh={m.refHigh} flag={m.flag} />
                </td>
                <td className="px-2 py-2.5">
                  <FlagBadge flag={m.flag} />
                </td>
                <td className="px-1 py-2.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setMeaningFor((cur) => (cur === m.name ? null : m.name))
                    }}
                    title={`What does ${m.name} mean?`}
                    className={cn(
                      'rounded-sm p-1 transition',
                      meaningFor === m.name
                        ? 'bg-fuchsia-400/15 text-fuchsia-300'
                        : 'text-slate-500 hover:bg-fuchsia-400/10 hover:text-fuchsia-300',
                    )}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </td>
                {onDelete && (
                  <td className="px-1 py-2.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(m.name)
                      }}
                      title={`Delete ${m.name}`}
                      className="rounded-sm p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:bg-rose-400/10 hover:text-rose-300"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
              {meaningFor === m.name && (
                <tr className="border-b border-cyan-400/8">
                  <td colSpan={colCount} className="p-0">
                    <MarkerMeaning marker={m} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
