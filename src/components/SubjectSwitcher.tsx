import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Loader2, UserRound, UsersRound } from 'lucide-react'
import { ageFromBirthDate, subjectLabel, type Subject } from '@/lib/api'

interface SubjectSwitcherProps {
  subjects: Subject[]
  activeId: string
  /** switch the dashboard to another person */
  onSwitch: (id: string) => void | Promise<void>
  /** open account management, where people are added and edited */
  onManage: () => void
  busy?: boolean
}

/**
 * Picks which person the dashboard is showing. Hidden entirely when only one
 * person is tracked, so a single-person install looks exactly as it did before.
 */
export function SubjectSwitcher({ subjects, activeId, onSwitch, onManage, busy }: SubjectSwitcherProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // the dashboard clips overflow on the desktop layout, so the menu is
  // portalled to the body and positioned from the button's own rectangle
  const [anchor, setAnchor] = useState({ top: 0, right: 0 })

  const place = useCallback(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setAnchor({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  const active = subjects.find((s) => s.id === activeId)
  if (subjects.length <= 1) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          // measure here rather than in an effect: the rectangle is known at
          // click time, and setting it during an effect cascades renders
          if (!open) place()
          setOpen((v) => !v)
        }}
        disabled={busy}
        title="Switch person"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="hud-mono flex items-center gap-1.5 rounded-sm border border-cyan-400/30 bg-[#020817]/80 px-2 py-1 text-[10px] tracking-wider text-cyan-200/90 transition hover:bg-cyan-400/10 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UsersRound className="h-3 w-3" />}
        <span className="max-w-[9rem] truncate">
          {active ? subjectLabel(active).toUpperCase() : 'SELECT'}
        </span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{ position: 'fixed', top: anchor.top, right: anchor.right, zIndex: 60 }}
            className="w-56 overflow-hidden rounded-sm border border-cyan-400/30 bg-[#020817] shadow-[0_0_40px_rgba(34,211,238,0.18)]"
          >
          {subjects.map((s) => {
            const age = ageFromBirthDate(s.birthDate)
            const isActive = s.id === activeId
            return (
              <button
                key={s.id}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setOpen(false)
                  if (!isActive) void onSwitch(s.id)
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-cyan-400/10"
              >
                <UserRound className="h-3.5 w-3.5 shrink-0 text-cyan-300/70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-cyan-100">{subjectLabel(s)}</span>
                  <span className="hud-mono block text-[9px] tracking-wider text-cyan-100/40">
                    {[s.sex === 'female' ? '♀' : '♂', age != null ? `${age} yrs` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
              </button>
            )
          })}
            <button
              onClick={() => {
                setOpen(false)
                onManage()
              }}
              className="hud-mono w-full border-t border-cyan-400/15 px-2.5 py-2 text-left text-[9px] tracking-[0.16em] text-cyan-200/70 transition hover:bg-cyan-400/10"
            >
              MANAGE PEOPLE…
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
