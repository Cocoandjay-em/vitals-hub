import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface HudPanelProps {
  title?: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

/** Translucent dark-blue panel with luminous border and corner brackets. */
export function HudPanel({ title, subtitle, right, children, className, bodyClassName }: HudPanelProps) {
  return (
    <section className={cn('hud-panel rounded-sm', className)}>
      <span className="hud-corner hud-corner-tl" />
      <span className="hud-corner hud-corner-tr" />
      <span className="hud-corner hud-corner-bl" />
      <span className="hud-corner hud-corner-br" />
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-cyan-400/15 px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            {title && <h2 className="hud-label">{title}</h2>}
            {subtitle && <span className="hud-mono text-[10px] text-cyan-100/40">{subtitle}</span>}
          </div>
          {right}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}
