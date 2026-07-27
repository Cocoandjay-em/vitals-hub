import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, Settings, X, XCircle } from 'lucide-react'
import { getConfig, putConfig, testConfig, type AiConfigPublic } from '@/lib/api'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  /** notify the parent when hasKey changes (extraction mode switches) */
  onConfigChange?: (cfg: AiConfigPublic) => void
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; detail: string }
  | { kind: 'fail'; detail: string }

/**
 * AI extraction settings: OpenAI-compatible endpoint + API key.
 * Values are stored server-side in the SQLite settings table; the key is
 * never returned by the API after being saved.
 */
export function SettingsModal({ open, onClose, onConfigChange }: SettingsModalProps) {
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!open) return
    setApiKey('')
    setTest({ kind: 'idle' })
    setNotice('')
    getConfig()
      .then((cfg) => {
        setBaseUrl(cfg.baseUrl)
        setModel(cfg.model)
        setHasKey(cfg.hasKey)
      })
      .catch(() => setNotice('⚠ Backend unreachable — start it with npm run dev.'))
  }, [open])

  const apply = useCallback(
    (cfg: AiConfigPublic) => {
      setBaseUrl(cfg.baseUrl)
      setModel(cfg.model)
      setHasKey(cfg.hasKey)
      onConfigChange?.(cfg)
    },
    [onConfigChange],
  )

  const handleSave = useCallback(async () => {
    setSaving(true)
    setNotice('')
    try {
      // only send the key when the user typed one; empty field = keep stored key
      const cfg = await putConfig({ baseUrl, model, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
      apply(cfg)
      setApiKey('')
      setNotice('✓ Settings saved')
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [baseUrl, model, apiKey, apply])

  const handleClearKey = useCallback(async () => {
    setSaving(true)
    try {
      const cfg = await putConfig({ apiKey: '' })
      apply(cfg)
      setApiKey('')
      setNotice('✓ API key removed — extraction falls back to offline mode')
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [apply])

  const handleTest = useCallback(async () => {
    setTest({ kind: 'running' })
    // save first so the test uses exactly what is on screen
    try {
      await putConfig({ baseUrl, model, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
    } catch (err) {
      setTest({ kind: 'fail', detail: err instanceof Error ? err.message : String(err) })
      return
    }
    const result = await testConfig()
    setTest(result.ok ? { kind: 'ok', detail: result.detail } : { kind: 'fail', detail: result.detail })
    // refresh hasKey in case a new key was just saved
    getConfig().then(apply).catch(() => undefined)
  }, [baseUrl, model, apiKey, apply])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#01040c]/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-md border border-cyan-400/25 bg-[#020817] shadow-[0_0_60px_rgba(34,211,238,0.12)]">
        <div className="flex items-center gap-2 border-b border-cyan-400/15 px-4 py-3">
          <Settings className="h-4 w-4 text-cyan-300" />
          <h2 className="hud-mono text-xs font-semibold tracking-[0.2em] text-cyan-100">
            SETTINGS
          </h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-sm p-1 text-slate-400 transition hover:bg-cyan-400/10 hover:text-cyan-200"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          <span className="hud-label">AI extraction</span>

          <p className="text-[11px] leading-relaxed text-cyan-100/60">
            With an API key, lab reports are read by a vision model on an OpenAI-compatible
            endpoint — works with OpenAI, Moonshot/Kimi, OpenRouter or a local server
            (Ollama, LM&nbsp;Studio). Without a key, extraction stays fully offline
            (PDF text + OCR). The key is stored only in the local database and never
            sent anywhere except the configured endpoint.
          </p>

          <label className="flex flex-col gap-1">
            <span className="hud-label">API key {hasKey && <em className="ml-1 not-italic text-emerald-300/80">· saved</em>}</span>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••  (leave empty to keep)' : 'sk-…'}
                autoComplete="off"
                className="hud-mono w-full rounded-sm border border-cyan-400/25 bg-[#01040c]/80 px-2 py-1.5 pr-8 text-[12px] text-cyan-100 outline-none placeholder:text-cyan-100/25 focus:border-cyan-300/60"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-cyan-200"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="hud-label">Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              className="hud-mono w-full rounded-sm border border-cyan-400/25 bg-[#01040c]/80 px-2 py-1.5 text-[12px] text-cyan-100 outline-none placeholder:text-cyan-100/25 focus:border-cyan-300/60"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="hud-label">Vision model</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-5.6-luna · gpt-5.6-terra · moonshot-v1-32k-vision-preview …"
              spellCheck={false}
              className="hud-mono w-full rounded-sm border border-cyan-400/25 bg-[#01040c]/80 px-2 py-1.5 text-[12px] text-cyan-100 outline-none placeholder:text-cyan-100/25 focus:border-cyan-300/60"
            />
          </label>

          {test.kind === 'ok' && (
            <p className="flex items-start gap-1.5 text-[11px] text-emerald-300">
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> {test.detail}
            </p>
          )}
          {test.kind === 'fail' && (
            <p className="flex items-start gap-1.5 text-[11px] text-rose-300">
              <XCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {test.detail}
            </p>
          )}
          {notice && (
            <p className={`hud-mono text-[11px] tracking-wider ${notice.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300'}`}>
              {notice}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-cyan-400/15 px-4 py-3">
          <button
            onClick={handleTest}
            disabled={saving || test.kind === 'running'}
            className="hud-mono flex items-center gap-1 rounded-sm border border-cyan-400/30 px-2.5 py-1 text-[10px] tracking-wider text-cyan-200/90 transition hover:bg-cyan-400/10 disabled:opacity-40"
          >
            {test.kind === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
            TEST CONNECTION
          </button>
          {hasKey && (
            <button
              onClick={handleClearKey}
              disabled={saving}
              className="hud-mono rounded-sm border border-rose-400/40 px-2.5 py-1 text-[10px] tracking-wider text-rose-300/90 transition hover:bg-rose-400/10 disabled:opacity-40"
            >
              REMOVE KEY
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="hud-mono ml-auto flex items-center gap-1 rounded-sm border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[10px] tracking-wider text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            SAVE
          </button>
        </div>
      </div>
    </div>
  )
}
