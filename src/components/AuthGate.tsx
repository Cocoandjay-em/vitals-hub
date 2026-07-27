import { useCallback, useEffect, useState } from 'react'
import { Activity, Loader2, LogIn, ShieldCheck } from 'lucide-react'
import * as api from '@/lib/api'

/**
 * Gate in front of the whole dashboard.
 *
 * On a fresh install no account exists yet, so the first visitor is asked to
 * create one (there is no default password to forget to change). Afterwards a
 * username + password unlocks a 30-day session cookie. Any API call rejected
 * for a dead session drops straight back here.
 */

type Phase = 'checking' | 'setup' | 'login' | 'ready'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [username, setUsername] = useState('')
  // bumped after a successful sign-in / account creation to re-read the status
  const [reload, setReload] = useState(0)
  const refresh = useCallback(() => setReload((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await api.getAuthStatus()
        if (cancelled) return
        setUsername(status.username ?? '')
        setPhase(status.authenticated ? 'ready' : status.configured ? 'login' : 'setup')
      } catch {
        // backend unreachable: show the login screen, which surfaces the error
        if (!cancelled) setPhase('login')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reload])

  // a session that dies mid-use sends everyone back to the login screen
  useEffect(() => {
    const onLost = () => setPhase((p) => (p === 'ready' ? 'login' : p))
    window.addEventListener(api.UNAUTHENTICATED_EVENT, onLost)
    return () => window.removeEventListener(api.UNAUTHENTICATED_EVENT, onLost)
  }, [])

  if (phase === 'checking') {
    return (
      <div className="hud-bg flex min-h-screen items-center justify-center">
        <p className="hud-mono flex items-center gap-2 text-[11px] tracking-[0.2em] text-cyan-300">
          <Loader2 className="h-4 w-4 animate-spin" /> CHECKING SESSION…
        </p>
      </div>
    )
  }

  if (phase === 'ready') {
    return (
      <>
        {children}
        <SignedInBadge
          username={username}
          onSignOut={async () => {
            await api.logout().catch(() => undefined)
            setPhase('login')
          }}
        />
      </>
    )
  }

  return <AuthForm mode={phase} onDone={refresh} />
}

/** Small persistent control: who you are, and a way out. */
function SignedInBadge({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  return (
    <div className="pointer-events-none fixed bottom-1 right-2 z-40">
      <div className="pointer-events-auto flex items-center gap-2 rounded-sm border border-cyan-400/20 bg-[#020817]/85 px-2 py-1 backdrop-blur-sm">
        <ShieldCheck className="h-3 w-3 text-emerald-400/80" />
        <span className="hud-mono text-[9px] tracking-wider text-cyan-100/60">
          {username.toUpperCase()}
        </span>
        <button
          onClick={onSignOut}
          className="hud-mono rounded-sm border border-cyan-400/25 px-1.5 py-px text-[9px] tracking-wider text-cyan-200/80 transition hover:bg-cyan-400/10"
        >
          SIGN OUT
        </button>
      </div>
    </div>
  )
}

function AuthForm({ mode, onDone }: { mode: 'setup' | 'login'; onDone: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [sex, setSex] = useState<'male' | 'female'>('male')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isSetup = mode === 'setup'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (isSetup && password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (isSetup) {
        await api.setupAccount(username.trim(), password, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthDate,
          sex,
        })
      } else await api.login(username.trim(), password)
      setPassword('')
      setConfirm('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hud-bg flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-sm border border-cyan-400/25 bg-[#020817]/90 p-5 shadow-[0_0_60px_rgba(34,211,238,0.12)]"
      >
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5 text-cyan-300" />
          <h1 className="hud-mono text-[15px] font-semibold tracking-[0.2em] text-cyan-50">
            VITALS&nbsp;HUB
          </h1>
        </div>

        <p className="hud-mono mb-4 text-[9px] leading-relaxed tracking-wider text-cyan-100/45">
          {isSetup
            ? 'FIRST RUN · CREATE THE OWNER ACCOUNT. THIS IS THE ONLY ACCOUNT — THERE IS NO DEFAULT PASSWORD.'
            : 'SIGN IN TO ACCESS YOUR HEALTH DATA'}
        </p>

        <label className="mb-3 flex flex-col gap-1">
          <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">USERNAME</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1.5 text-[12px] text-cyan-100 outline-none focus:border-cyan-400/60"
          />
        </label>

        <label className="mb-3 flex flex-col gap-1">
          <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">
            PASSWORD {isSetup && <span className="text-cyan-100/30">· MIN 10 CHARACTERS</span>}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            required
            className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1.5 text-[12px] text-cyan-100 outline-none focus:border-cyan-400/60"
          />
        </label>

        {isSetup && (
          <>
            <label className="mb-3 flex flex-col gap-1">
              <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">
                CONFIRM PASSWORD
              </span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1.5 text-[12px] text-cyan-100 outline-none focus:border-cyan-400/60"
              />
            </label>

            {/* profile — optional here, editable later under ACCOUNT */}
            <div className="mb-3 border-t border-cyan-400/15 pt-3">
              <p className="hud-mono mb-2 text-[9px] tracking-[0.18em] text-cyan-100/45">
                YOUR PROFILE <span className="text-cyan-100/25">· OPTIONAL</span>
              </p>

              <div className="mb-2 grid grid-cols-2 gap-2">
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                  className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1.5 text-[12px] text-cyan-100 outline-none placeholder:text-cyan-100/25 focus:border-cyan-400/60"
                />
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  autoComplete="family-name"
                  className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1.5 text-[12px] text-cyan-100 outline-none placeholder:text-cyan-100/25 focus:border-cyan-400/60"
                />
              </div>

              <label className="mb-2 flex flex-col gap-1">
                <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">
                  DATE OF BIRTH
                </span>
                <input
                  type="date"
                  value={birthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="hud-mono rounded-sm border border-cyan-400/25 bg-[#01040c] px-2 py-1.5 text-[12px] text-cyan-100 outline-none focus:border-cyan-400/60"
                />
              </label>

              <span className="hud-mono text-[9px] tracking-[0.18em] text-cyan-100/45">
                BODY MODEL
              </span>
              <div className="mt-1 flex gap-2">
                {(['male', 'female'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSex(s)}
                    className={`hud-mono flex-1 rounded-sm border px-2 py-1.5 text-[10px] tracking-[0.18em] transition ${
                      sex === s
                        ? 'border-cyan-300/70 bg-cyan-400/15 text-cyan-100'
                        : 'border-cyan-400/20 text-cyan-100/40 hover:bg-cyan-400/5'
                    }`}
                  >
                    {s === 'male' ? '♂ MALE' : '♀ FEMALE'}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[9px] leading-relaxed text-cyan-100/30">
                Picks which anatomy the 3D scan renders.
              </p>
            </div>
          </>
        )}

        {error && (
          <p className="hud-mono mb-3 rounded-sm border border-rose-400/40 bg-rose-400/10 px-2 py-1.5 text-[10px] leading-relaxed tracking-wider text-rose-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="hud-mono flex w-full items-center justify-center gap-2 rounded-sm border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-[11px] tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
          {isSetup ? 'CREATE ACCOUNT' : 'SIGN IN'}
        </button>

        <p className="hud-mono mt-4 text-center text-[8px] leading-relaxed tracking-[0.14em] text-cyan-100/25">
          SELF-HOSTED · YOUR DATA STAYS IN YOUR OWN DATABASE
        </p>
      </form>
    </div>
  )
}
