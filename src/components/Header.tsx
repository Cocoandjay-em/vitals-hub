import { Activity } from 'lucide-react'
import { EcgLine } from '@/components/EcgLine'
import { HudDial } from '@/components/HudDial'
import type { TestRecord } from '@/types/biomarker'

interface HeaderProps {
  latest: TestRecord | null
}

export function Header({ latest }: HeaderProps) {
  const counts = { high: 0, low: 0, normal: 0, unknown: 0 }
  for (const m of latest?.markers ?? []) counts[m.flag] += 1
  const total = latest?.markers.length ?? 0

  return (
    <header className="hud-panel relative overflow-hidden rounded-sm">
      <span className="hud-corner hud-corner-tl" />
      <span className="hud-corner hud-corner-tr" />
      <span className="hud-corner hud-corner-bl" />
      <span className="hud-corner hud-corner-br" />
      <div className="relative flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/5 shadow-[0_0_18px_rgba(34,211,238,0.25)]">
            <Activity className="h-6 w-6 text-cyan-300 hud-scan" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="hud-mono text-xl font-bold tracking-[0.22em] text-cyan-200 hud-glow-cyan">
              VITALS&nbsp;HUD
            </h1>
            <p className="hud-label mt-0.5">Blood biomarker dashboard · local-first</p>
          </div>
        </div>

        <EcgLine className="hidden h-10 min-w-0 flex-1 lg:block" />

        <div className="flex items-center justify-between gap-5 lg:justify-end">
          {latest ? (
            <>
              <div className="flex items-center gap-4">
                <HudDial value={counts.high} total={total} label="High" color="#f43f5e" glowClass="hud-glow-high" />
                <HudDial value={counts.low} total={total} label="Low" color="#f59e0b" glowClass="hud-glow-low" />
                <HudDial value={counts.normal} total={total} label="Normal" color="#34d399" glowClass="hud-glow-normal" />
              </div>
              <div className="text-right">
                <p className="hud-label">Latest test</p>
                <p className="hud-mono mt-1 text-sm font-bold tracking-wider text-cyan-100">{latest.date}</p>
                <p className="hud-mono text-[10px] text-cyan-100/45">{total} markers</p>
              </div>
            </>
          ) : (
            <p className="hud-mono text-[11px] tracking-wider text-cyan-100/40">
              AWAITING FIRST TEST — UPLOAD A REPORT OR LOAD DEMO DATA
            </p>
          )}
        </div>
      </div>
      <EcgLine className="h-8 w-full lg:hidden" />
    </header>
  )
}
