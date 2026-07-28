import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, UserPlus, UserRound, UsersRound, X } from 'lucide-react'
import {
  ageFromBirthDate,
  changePassword,
  createSubject,
  deleteSubject,
  getProfile,
  putProfile,
  subjectLabel,
  type Profile,
  type Subject,
} from '@/lib/api'

interface AccountModalProps {
  open: boolean
  onClose: () => void
  /** the signed-in username, shown read-only */
  username: string
  /** lets the dashboard swap the 3D body model as soon as the profile changes */
  onProfileChange?: (profile: Profile) => void
  /** everyone tracked under this login */
  subjects?: Subject[]
  activeSubjectId?: string
  onSwitchSubject?: (id: string) => void | Promise<void>
  /** the list changed — the dashboard should reload it */
  onPeopleChanged?: () => void | Promise<void>
}

const EMPTY: Profile = { firstName: '', lastName: '', birthDate: '', sex: 'male' }

/**
 * Account management: who you are (name, birth date, body model) and the
 * credentials you sign in with. The profile lives in the settings table, so
 * it travels with the database.
 */
export function AccountModal({
  open,
  onClose,
  username,
  onProfileChange,
  subjects = [],
  activeSubjectId = '',
  onSwitchSubject,
  onPeopleChanged,
}: AccountModalProps) {
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileNotice, setProfileNotice] = useState('')

  const [addingPerson, setAddingPerson] = useState(false)
  const [savingPerson, setSavingPerson] = useState(false)
  const [peopleNotice, setPeopleNotice] = useState('')
  const [newFirst, setNewFirst] = useState('')
  const [newLast, setNewLast] = useState('')
  const [newBirth, setNewBirth] = useState('')
  const [newSex, setNewSex] = useState<'male' | 'female'>('male')

  const addPerson = useCallback(async () => {
    setSavingPerson(true)
    setPeopleNotice('')
    try {
      await createSubject({
        firstName: newFirst.trim(),
        lastName: newLast.trim(),
        birthDate: newBirth,
        sex: newSex,
      })
      setNewFirst('')
      setNewLast('')
      setNewBirth('')
      setNewSex('male')
      setAddingPerson(false)
      await onPeopleChanged?.()
      setPeopleNotice('✓ Person added')
    } catch (err) {
      setPeopleNotice(`⚠ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingPerson(false)
    }
  }, [newFirst, newLast, newBirth, newSex, onPeopleChanged])

  const removePerson = useCallback(
    async (s: Subject) => {
      const label = subjectLabel(s)
      if (
        !window.confirm(
          `Remove ${label} and permanently delete every test, marker and report recorded for them? This cannot be undone.`,
        )
      ) {
        return
      }
      setPeopleNotice('')
      try {
        await deleteSubject(s.id)
        await onPeopleChanged?.()
        setPeopleNotice(`✓ ${label} removed`)
      } catch (err) {
        setPeopleNotice(`⚠ ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [onPeopleChanged],
  )

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordNotice, setPasswordNotice] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProfileNotice('')
    setPasswordNotice('')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    void (async () => {
      try {
        const p = await getProfile()
        if (!cancelled) setProfile(p)
      } catch {
        if (!cancelled) setProfileNotice('⚠ Could not load your profile — is the backend running?')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const saveProfile = useCallback(async () => {
    setSavingProfile(true)
    setProfileNotice('')
    try {
      const saved = await putProfile(profile)
      setProfile(saved)
      onProfileChange?.(saved)
      setProfileNotice('✓ Profile saved')
    } catch (err) {
      setProfileNotice(`⚠ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingProfile(false)
    }
  }, [profile, onProfileChange])

  const savePassword = useCallback(async () => {
    if (newPassword !== confirmPassword) {
      setPasswordNotice('⚠ The two new passwords do not match.')
      return
    }
    setSavingPassword(true)
    setPasswordNotice('')
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordNotice('✓ Password changed — every other session was signed out')
    } catch (err) {
      setPasswordNotice(`⚠ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingPassword(false)
    }
  }, [currentPassword, newPassword, confirmPassword])

  if (!open) return null

  const age = ageFromBirthDate(profile.birthDate)
  const field =
    'hud-mono w-full rounded-sm border border-cyan-400/25 bg-[#01040c]/80 px-2 py-1.5 text-[12px] text-cyan-100 outline-none placeholder:text-cyan-100/25 focus:border-cyan-300/60'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#01040c]/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="hud-scroll max-h-[90vh] w-full max-w-md overflow-y-auto rounded-md border border-cyan-400/25 bg-[#020817] shadow-[0_0_60px_rgba(34,211,238,0.12)]">
        <div className="sticky top-0 flex items-center gap-2 border-b border-cyan-400/15 bg-[#020817] px-4 py-3">
          <UserRound className="h-4 w-4 text-cyan-300" />
          <h2 className="hud-mono text-xs font-semibold tracking-[0.2em] text-cyan-100">ACCOUNT</h2>
          <span className="hud-mono text-[9px] tracking-wider text-cyan-100/40">
            {username.toUpperCase()}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-sm p-1 text-slate-400 transition hover:bg-cyan-400/10 hover:text-cyan-200"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---------------------------- profile ---------------------------- */}
        <div className="flex flex-col gap-3 px-4 py-4">
          <span className="hud-label">Profile</span>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="hud-label">First name</span>
              <input
                value={profile.firstName}
                onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
                autoComplete="given-name"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="hud-label">Last name</span>
              <input
                value={profile.lastName}
                onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
                autoComplete="family-name"
                className={field}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="hud-label">
              Date of birth{' '}
              {age != null && <em className="not-italic text-cyan-100/40">· {age} years</em>}
            </span>
            <input
              type="date"
              value={profile.birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setProfile((p) => ({ ...p, birthDate: e.target.value }))}
              className={field}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="hud-label">Body model</span>
            <div className="flex gap-2">
              {(['male', 'female'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setProfile((p) => ({ ...p, sex: s }))}
                  className={`hud-mono flex-1 rounded-sm border px-2 py-1.5 text-[10px] tracking-[0.18em] transition ${
                    profile.sex === s
                      ? 'border-cyan-300/70 bg-cyan-400/15 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                      : 'border-cyan-400/20 text-cyan-100/40 hover:bg-cyan-400/5'
                  }`}
                >
                  {s === 'male' ? '♂ MALE' : '♀ FEMALE'}
                </button>
              ))}
            </div>
            <span className="text-[10px] leading-relaxed text-cyan-100/35">
              Chooses which Visible Human anatomy the 3D scan renders. Only these two model
              sets exist, so this is about the body drawn on screen, not how you identify.
            </span>
          </div>

          {profileNotice && (
            <p
              className={`hud-mono text-[11px] tracking-wider ${
                profileNotice.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {profileNotice}
            </p>
          )}

          <button
            onClick={() => void saveProfile()}
            disabled={savingProfile}
            className="hud-mono flex items-center justify-center gap-1 rounded-sm border border-emerald-400/50 bg-emerald-400/10 px-3 py-1.5 text-[10px] tracking-wider text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
          >
            {savingProfile && <Loader2 className="h-3 w-3 animate-spin" />}
            SAVE PROFILE
          </button>
        </div>

        {/* ----------------------------- people ---------------------------- */}
        <div className="flex flex-col gap-3 border-t border-cyan-400/15 px-4 py-4">
          <span className="hud-label flex items-center gap-1.5">
            <UsersRound className="h-3 w-3" /> People on this account
          </span>
          <p className="text-[10px] leading-relaxed text-cyan-100/35">
            Each person keeps their own tests, reports and body scan. Anyone signed in with this
            account can see all of them.
          </p>

          <div className="flex flex-col gap-1">
            {subjects.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 ${
                  s.id === activeSubjectId ? 'border-cyan-300/50 bg-cyan-400/10' : 'border-cyan-400/15'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-cyan-100">
                  {subjectLabel(s)}
                  {s.id === activeSubjectId && (
                    <em className="hud-mono ml-1.5 not-italic text-[9px] tracking-wider text-cyan-300/70">
                      · VIEWING
                    </em>
                  )}
                </span>
                {s.id !== activeSubjectId && (
                  <button
                    onClick={() => void onSwitchSubject?.(s.id)}
                    className="hud-mono rounded-sm border border-cyan-400/25 px-1.5 py-0.5 text-[9px] tracking-wider text-cyan-200/80 transition hover:bg-cyan-400/10"
                  >
                    VIEW
                  </button>
                )}
                {subjects.length > 1 && (
                  <button
                    onClick={() => void removePerson(s)}
                    title="Remove this person and everything recorded about them"
                    className="hud-mono rounded-sm border border-rose-400/30 px-1.5 py-0.5 text-[9px] tracking-wider text-rose-300/80 transition hover:bg-rose-400/10"
                  >
                    REMOVE
                  </button>
                )}
              </div>
            ))}
          </div>

          {addingPerson ? (
            <div className="flex flex-col gap-2 rounded-sm border border-cyan-400/20 p-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newFirst}
                  onChange={(e) => setNewFirst(e.target.value)}
                  placeholder="First name"
                  className={field}
                />
                <input
                  value={newLast}
                  onChange={(e) => setNewLast(e.target.value)}
                  placeholder="Last name"
                  className={field}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={newBirth}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setNewBirth(e.target.value)}
                  className={field}
                />
                <select
                  value={newSex}
                  onChange={(e) => setNewSex(e.target.value as 'male' | 'female')}
                  className={field}
                >
                  <option value="male">♂ Male</option>
                  <option value="female">♀ Female</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void addPerson()}
                  disabled={savingPerson}
                  className="hud-mono flex flex-1 items-center justify-center gap-1 rounded-sm border border-emerald-400/50 bg-emerald-400/10 px-2 py-1 text-[10px] tracking-wider text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
                >
                  {savingPerson && <Loader2 className="h-3 w-3 animate-spin" />} ADD
                </button>
                <button
                  onClick={() => setAddingPerson(false)}
                  className="hud-mono rounded-sm border border-cyan-400/25 px-2 py-1 text-[10px] tracking-wider text-cyan-200/70 transition hover:bg-cyan-400/10"
                >
                  CANCEL
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingPerson(true)}
              className="hud-mono flex items-center justify-center gap-1 rounded-sm border border-cyan-400/40 px-3 py-1.5 text-[10px] tracking-wider text-cyan-200 transition hover:bg-cyan-400/10"
            >
              <UserPlus className="h-3 w-3" /> ADD A PERSON
            </button>
          )}

          {peopleNotice && (
            <p
              className={`hud-mono text-[11px] tracking-wider ${
                peopleNotice.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {peopleNotice}
            </p>
          )}
        </div>

        {/* --------------------------- credentials -------------------------- */}
        <div className="flex flex-col gap-3 border-t border-cyan-400/15 px-4 py-4">
          <span className="hud-label flex items-center gap-1.5">
            <KeyRound className="h-3 w-3" /> Change password
          </span>

          <label className="flex flex-col gap-1">
            <span className="hud-label">Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className={field}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="hud-label">New · min 10</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="hud-label">Confirm new</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className={field}
              />
            </label>
          </div>

          {passwordNotice && (
            <p
              className={`hud-mono text-[11px] leading-relaxed tracking-wider ${
                passwordNotice.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {passwordNotice}
            </p>
          )}

          <button
            onClick={() => void savePassword()}
            disabled={savingPassword || !currentPassword || !newPassword}
            className="hud-mono flex items-center justify-center gap-1 rounded-sm border border-cyan-400/40 px-3 py-1.5 text-[10px] tracking-wider text-cyan-200 transition hover:bg-cyan-400/10 disabled:opacity-40"
          >
            {savingPassword && <Loader2 className="h-3 w-3 animate-spin" />}
            CHANGE PASSWORD
          </button>

          <p className="hud-mono text-[8px] leading-relaxed tracking-[0.14em] text-cyan-100/25">
            THERE IS NO PASSWORD RESET — THIS IS A SINGLE-ACCOUNT SELF-HOSTED APP. KEEP IT
            SOMEWHERE SAFE.
          </p>
        </div>
      </div>
    </div>
  )
}
