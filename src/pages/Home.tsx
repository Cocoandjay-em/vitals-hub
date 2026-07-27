import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Database, Download, Eraser, FileText, FileUp, HeartPulse, Loader2, PenLine, Scale, Settings, Sparkles, Table2, Thermometer, TriangleAlert, Upload, X } from 'lucide-react'
import type { BiomarkerReading, ExtractionResult, TestRecord } from '@/types/biomarker'
import type { ClinicalReport } from '@/types/report'
import { extractFromFile, rasteriseForAI } from '@/lib/extract'
import { clearLegacyHistory, exportHistory, loadLegacyHistory, parseImport } from '@/lib/storage'
import { APPLE_HEALTH_ACCEPT, APPLE_HEALTH_TOOLTIP, parseAppleHealthExport } from '@/lib/appleHealth'
import * as api from '@/lib/api'
import { buildDemoRecords } from '@/lib/demoData'
import { Header } from '@/components/Header'
import { HudPanel } from '@/components/HudPanel'
import { FLAG_COLOR } from '@/lib/flags'
import { BodyScan3D, type BodySex } from '@/components/BodyScan3D'
import { UploadZone } from '@/components/UploadZone'
import { ExtractionReview } from '@/components/ExtractionReview'
import { ReportReview, type ReportDraft } from '@/components/ReportReview'
import { ResultsTable } from '@/components/ResultsTable'
import { HistoryList } from '@/components/HistoryList'
import { ManualEntryForm } from '@/components/ManualEntryForm'
import { PanelAnalysis } from '@/components/PanelAnalysis'
import { SettingsModal } from '@/components/SettingsModal'
import { VitalCard, type VitalSeries } from '@/components/VitalCard'
import { TrendChart, type TrendPoint } from '@/components/TrendChart'

export default function Home() {
  const [history, setHistory] = useState<TestRecord[]>([])
  const [backendOffline, setBackendOffline] = useState(false)
  const [extractions, setExtractions] = useState<ExtractionResult[]>([])
  const [reports, setReports] = useState<ClinicalReport[]>([])
  const [reportDrafts, setReportDrafts] = useState<ReportDraft[]>([])
  const [processing, setProcessing] = useState(false)
  const [status, setStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null)
  const [viewDate, setViewDate] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showIntake, setShowIntake] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [trendOpen, setTrendOpen] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [bodySex, setBodySex] = useState<BodySex>('male') // profile drives the body model; owner is male
  const importRef = useRef<HTMLInputElement>(null)
  const ahRef = useRef<HTMLInputElement>(null)
  const reportRef = useRef<HTMLInputElement>(null)

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.getHistory())
      setBackendOffline(false)
    } catch {
      setBackendOffline(true)
    }
  }, [])

  const refreshReports = useCallback(async () => {
    try {
      setReports(await api.getReports())
    } catch {
      /* reports are optional — a failure here must not blank the dashboard */
    }
  }, [])

  useEffect(() => {
    void refreshHistory()
    void refreshReports()
    api.getConfig().then((cfg) => setAiEnabled(cfg.hasKey)).catch(() => undefined)
    api.getProfile().then((p) => setBodySex(p.sex)).catch(() => undefined)
    // Old browser-only storage is obsolete — wipe it silently; reports get re-uploaded.
    const legacy = loadLegacyHistory()
    if (legacy.length > 0) {
      clearLegacyHistory()
      setNotice('Old browser-only data wiped — re-upload your reports')
      window.setTimeout(() => setNotice(''), 6000)
    }
  }, [refreshHistory, refreshReports])

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 5000)
  }, [])

  /**
   * "Current state": the newest value of EVERY marker, merged across records.
   * Without this, a quick manual entry (e.g. today's blood pressure) becomes the
   * "latest test" and hides the entire lab panel from the body map and header.
   */
  const latestMerged = useMemo<TestRecord | null>(() => {
    if (history.length === 0) return null
    const last = history[history.length - 1]
    const byName = new Map<string, BiomarkerReading>()
    for (const t of history) {
      for (const m of t.markers) byName.set(m.name, m)
    }
    return {
      ...last,
      markers: [...byName.values()],
      sources: [...new Set(history.flatMap((t) => t.sources))],
    }
  }, [history])

  const viewed = useMemo(
    () => (viewDate ? (history.find((t) => t.date === viewDate) ?? latestMerged) : latestMerged),
    [history, viewDate, latestMerged],
  )

  /** Vital-sign series across all records (weight, BP, heart rate, temperature). */
  const vitals = useMemo(() => {
    const collect = (match: RegExp): VitalSeries | null => {
      const points: VitalSeries['points'] = []
      let unit = ''
      let name = ''
      for (const t of history) {
        for (const m of t.markers) {
          if (match.test(m.name)) {
            points.push({ date: t.date, value: m.value, flag: m.flag })
            unit = m.unit
            name = m.name
          }
        }
      }
      return points.length > 0 ? { name, unit, points } : null
    }
    return {
      weight: collect(/^weight$/i),
      bpSys: collect(/^blood pressure systolic$/i),
      bpDia: collect(/^blood pressure diastolic$/i),
      heartRate: collect(/^heart rate$/i),
      temperature: collect(/^body temperature$/i),
    }
  }, [history])

  /** Out-of-range markers of the current state — the red alerts around the body. */
  const alerts = useMemo(
    () => (latestMerged?.markers ?? []).filter((m) => m.flag === 'high' || m.flag === 'low'),
    [latestMerged],
  )

  // default selected marker: first out-of-range marker of the viewed test
  useEffect(() => {
    if (!viewed) return
    if (selectedMarker && viewed.markers.some((m) => m.name === selectedMarker)) return
    const out = viewed.markers.find((m) => m.flag === 'high' || m.flag === 'low')
    setSelectedMarker((out ?? viewed.markers[0])?.name ?? null)
  }, [viewed, selectedMarker])

  const trend: { name: string; unit: string; refLow: number | null; refHigh: number | null; points: TrendPoint[] } | null =
    useMemo(() => {
      if (!selectedMarker) return null
      const points: TrendPoint[] = []
      let unit = ''
      let refLow: number | null = null
      let refHigh: number | null = null
      for (const t of history) {
        const m = t.markers.find((x) => x.name === selectedMarker)
        if (m) {
          points.push({ date: t.date, reading: m })
          unit = m.unit
          refLow = m.refLow
          refHigh = m.refHigh
        }
      }
      if (points.length === 0) return null
      return { name: selectedMarker, unit, refLow, refHigh, points }
    }, [history, selectedMarker])

  const handleFiles = useCallback(async (files: File[]) => {
    setProcessing(true)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setStatus(`Processing ${i + 1}/${files.length}: ${file.name}`)
      const result = await extractFromFile(file, setStatus)
      setExtractions((prev) => [...prev, result])
    }
    setStatus('')
    setProcessing(false)
  }, [])

  const handleConfirm = useCallback(
    async (index: number, dateOverride?: string) => {
      const r = extractions[index]
      if (!r || !r.ok) return
      const date = dateOverride ?? r.date
      if (!date) return
      // drop sourceLine — it is parser provenance, not part of the saved record
      const markers: BiomarkerReading[] = r.rows.map((row) => ({
        name: row.name,
        category: row.category,
        value: row.value,
        unit: row.unit,
        refLow: row.refLow,
        refHigh: row.refHigh,
        flag: row.flag,
      }))
      try {
        await api.saveTest({ date, source: r.fileName, biomarkers: markers })
      } catch (err) {
        flashNotice(`⚠ Save failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      await refreshHistory()
      setExtractions((prev) => prev.filter((_, i) => i !== index))
      flashNotice(`✓ Added ${r.rows.length} markers from ${r.fileName} (${date})`)
      setViewDate(date)
    },
    [extractions, refreshHistory, flashNotice],
  )

  const handleDiscard = useCallback((index: number) => {
    setExtractions((prev) => prev.filter((_, i) => i !== index))
  }, [])

  /* ------------------------- clinical reports ------------------------- */

  /** Read a file as base64 so the original document can be stored server-side. */
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error('Could not read the file'))
      reader.readAsDataURL(file)
    })

  /** Specialist visit reports: AI proposes date, organ and stage; user confirms. */
  const handleReportFiles = useCallback(
    async (files: File[]) => {
      setProcessing(true)
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setStatus(`Reading report ${i + 1}/${files.length}: ${file.name}`)
        try {
          const pages = await rasteriseForAI(file, setStatus)
          setStatus(`AI: staging ${file.name}…`)
          const analysis = await api.analyzeReport(pages)
          const draft: ReportDraft = { ...analysis, fileName: file.name }
          // keep the original document only when the backend can store its type
          if (['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            draft.fileBase64 = await fileToBase64(file)
            draft.mime = file.type
          }
          setReportDrafts((prev) => [...prev, draft])
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          setReportDrafts((prev) => [
            ...prev,
            {
              fileName: file.name,
              date: null,
              title: file.name,
              specialty: '',
              region: 'systemic',
              stage: 'unknown',
              stageRationale: '',
              summary: '',
              findings: [],
              followUp: '',
              error:
                err instanceof api.ApiError && err.code === 'NO_API_KEY'
                  ? 'Clinical reports need an AI key — add one under AI KEY. Offline staging is not possible.'
                  : `Could not read this report: ${message}`,
            },
          ])
        }
      }
      setStatus('')
      setProcessing(false)
    },
    [],
  )

  const handleConfirmReport = useCallback(
    async (index: number, edited: ReportDraft) => {
      try {
        await api.saveReport({
          date: edited.date ?? new Date().toISOString().slice(0, 10),
          title: edited.title,
          specialty: edited.specialty,
          region: edited.region,
          stage: edited.stage,
          // a stage the user changed away from the AI proposal is their own call
          stageSource: edited.stage === reportDrafts[index]?.stage ? 'ai' : 'user',
          stageRationale: edited.stageRationale,
          summary: edited.summary,
          findings: edited.findings,
          followUp: edited.followUp,
          fileName: edited.fileName,
          fileBase64: edited.fileBase64,
          mime: edited.mime,
        })
      } catch (err) {
        flashNotice(`⚠ Save failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      await refreshReports()
      setReportDrafts((prev) => prev.filter((_, i) => i !== index))
      flashNotice(`✓ Report attached to ${edited.region.toUpperCase()} (${edited.date})`)
    },
    [reportDrafts, refreshReports, flashNotice],
  )

  const handleDiscardReport = useCallback((index: number) => {
    setReportDrafts((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleDeleteReport = useCallback(
    async (id: string) => {
      const report = reports.find((r) => r.id === id)
      if (!window.confirm(`Delete the report "${report?.title ?? id}"? The stored document is removed too.`)) return
      try {
        await api.deleteReport(id)
      } catch (err) {
        flashNotice(`⚠ Delete failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      await refreshReports()
    },
    [reports, refreshReports, flashNotice],
  )

  /** User override of a stage the AI assigned. */
  const handleRestageReport = useCallback(
    async (id: string, stage: string) => {
      try {
        await api.patchReport(id, { stage })
      } catch (err) {
        flashNotice(`⚠ Could not update the stage: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      await refreshReports()
      flashNotice(`✓ Stage set to ${stage.toUpperCase()}`)
    },
    [refreshReports, flashNotice],
  )

  /** Manual entry: save one or more measurements into the test record for their date. */
  const handleSaveManual = useCallback(
    async (date: string, markers: BiomarkerReading[]) => {
      try {
        await api.saveTest({ date, source: 'Manual entry', biomarkers: markers })
      } catch (err) {
        flashNotice(`⚠ Save failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      await refreshHistory()
      setShowManual(false)
      flashNotice(`✓ Saved ${markers.map((m) => `${m.name} ${m.value} ${m.unit}`).join(' · ')} (${date})`)
      setViewDate(date)
    },
    [refreshHistory, flashNotice],
  )

  /** Delete a single marker row from the currently viewed test. */
  const handleDeleteMarker = useCallback(
    async (name: string) => {
      if (!viewed) return
      const marker = viewed.markers.find((m) => m.name === name)
      if (marker?.id == null) {
        flashNotice('⚠ Cannot delete: marker id unknown — try reloading.')
        return
      }
      if (!window.confirm(`Delete "${name}" from the ${viewed.date} record?`)) return
      try {
        await api.deleteMarker(marker.id)
      } catch (err) {
        flashNotice(`⚠ Delete failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      await refreshHistory()
      if (selectedMarker === name) setSelectedMarker(null)
    },
    [viewed, selectedMarker, refreshHistory, flashNotice],
  )

  const handleDemo = useCallback(async () => {
    try {
      for (const rec of buildDemoRecords()) {
        await api.saveTest({ date: rec.date, source: 'Demo data', demo: true, biomarkers: rec.markers })
      }
    } catch (err) {
      flashNotice(`⚠ Demo seed failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    await refreshHistory()
  }, [refreshHistory, flashNotice])

  const handleClear = useCallback(async () => {
    if (!window.confirm('Delete ALL stored test history from the database?')) return
    try {
      await api.clearHistory()
    } catch (err) {
      flashNotice(`⚠ Clear failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    await refreshHistory()
  }, [refreshHistory, flashNotice])

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const records = parseImport(await file.text())
        for (const rec of records) {
          await api.saveTest({
            date: rec.date,
            source: rec.sources.join(', ') || 'import',
            demo: rec.demo ?? false,
            biomarkers: rec.markers,
          })
        }
        await refreshHistory()
        flashNotice(`✓ Imported ${records.length} record${records.length === 1 ? '' : 's'}`)
      } catch (err) {
        window.alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [refreshHistory, flashNotice],
  )

  /** Apple Health export.zip / export.xml import: stream-parse, upload in batches of 500. */
  const handleAppleHealth = useCallback(
    async (file: File) => {
      if (
        file.size > 80 * 1024 * 1024 &&
        !window.confirm(
          `This export is ${(file.size / 1024 / 1024).toFixed(0)} MB — parsing may take a few minutes. Continue?`,
        )
      ) {
        return
      }
      setProcessing(true)
      setStatus('Starting Apple Health import…')
      try {
        let batch: api.AppleHealthRecord[] = []
        let found = 0
        let imported = 0
        const days = new Set<string>()
        let chain: Promise<void> = Promise.resolve()
        const enqueueBatch = () => {
          if (batch.length === 0) return
          const toSend = batch
          batch = []
          chain = chain.then(async () => {
            const r = await api.importAppleHealth(toSend)
            imported += r.imported
            setStatus(`Importing… ${imported.toLocaleString()} / ${found.toLocaleString()} records`)
          })
        }
        found = await parseAppleHealthExport(
          file,
          (rec) => {
            batch.push(rec)
            days.add(rec.date)
            if (batch.length >= 500) enqueueBatch()
          },
          setStatus,
        )
        enqueueBatch()
        await chain
        await refreshHistory()
        if (imported === 0) {
          flashNotice('⚠ No blood pressure / heart rate / weight / temperature records found in this export')
        } else {
          flashNotice(`✓ Apple Health: imported ${imported.toLocaleString()} records across ${days.size} day${days.size === 1 ? '' : 's'}`)
        }
      } catch (err) {
        window.alert(`Apple Health import failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setStatus('')
        setProcessing(false)
      }
    },
    [refreshHistory, flashNotice],
  )

  /** Select a biomarker (vital card, alert, table row or body hotspot) → trend overlay. */
  const handleSelectMarker = useCallback((name: string) => {
    setSelectedMarker(name)
    setTrendOpen(true)
  }, [])

  return (
    <div className="hud-bg relative min-h-screen lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
      {/* header spans the full width */}
      <div className="relative z-10 shrink-0 px-3 pt-3 sm:px-5 sm:pt-4">
        <div className="mx-auto w-full max-w-[1700px]">
          <Header latest={latestMerged} />
        </div>
      </div>

      {/* command center: vital rails around the interactive body */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1700px] flex-1 flex-col gap-3 px-3 pb-2 pt-3 sm:px-5 lg:min-h-0 lg:flex-row lg:overflow-hidden">
        {/* left rail — vitals */}
        <div className="order-2 grid grid-cols-2 gap-3 lg:order-1 lg:flex lg:w-60 lg:shrink-0 lg:flex-col">
          <VitalCard
            title="WEIGHT"
            icon={<Scale className="h-3 w-3" />}
            series={vitals.weight ? [vitals.weight] : []}
            onOpen={handleSelectMarker}
          />
          <VitalCard
            title="HEART RATE"
            icon={<Activity className="h-3 w-3" />}
            series={vitals.heartRate ? [vitals.heartRate] : []}
            onOpen={handleSelectMarker}
          />
        </div>

        {/* center — the body; move the mouse to tilt it, click the organs */}
        <div className="order-1 flex min-w-0 flex-1 flex-col lg:order-2 lg:min-h-0">
          <div className="hud-mono mb-1 flex items-center justify-between px-1 text-[9px] tracking-[0.2em] text-cyan-100/40">
            <span>BODY MAP // ORGAN SYSTEMS</span>
            <span>{latestMerged ? `CURRENT STATE · ${latestMerged.date}` : 'AWAITING DATA'}</span>
          </div>
          <div className="relative h-[440px] sm:h-[500px] lg:h-auto lg:min-h-0 lg:flex-1">
            <BodyScan3D
              markers={latestMerged?.markers ?? null}
              date={latestMerged?.date}
              selected={selectedMarker}
              onSelectMarker={handleSelectMarker}
              sex={bodySex}
              reports={reports}
              onDeleteReport={handleDeleteReport}
              onRestageReport={handleRestageReport}
            />
          </div>
        </div>

        {/* right rail — vitals + red alerts */}
        <div className="order-3 grid grid-cols-2 gap-3 lg:flex lg:w-60 lg:shrink-0 lg:flex-col">
          <VitalCard
            title="BLOOD PRESSURE"
            icon={<HeartPulse className="h-3 w-3" />}
            series={[vitals.bpSys, vitals.bpDia].filter((s): s is VitalSeries => s != null)}
            pairLabels={['SYS', 'DIA']}
            onOpen={handleSelectMarker}
          />
          <VitalCard
            title="BODY TEMP"
            icon={<Thermometer className="h-3 w-3" />}
            series={vitals.temperature ? [vitals.temperature] : []}
            onOpen={handleSelectMarker}
          />
          <div className="col-span-2 rounded-sm border border-cyan-400/20 bg-[#020817]/70 px-3 py-2.5 backdrop-blur-sm lg:col-span-1">
            <p className="hud-mono flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-cyan-100/50">
              <TriangleAlert className="h-3 w-3 text-rose-400" /> ALERTS · OUT OF RANGE
            </p>
            {alerts.length === 0 ? (
              <p className="hud-mono mt-2 text-[9px] tracking-wider text-cyan-100/30">
                {latestMerged ? 'ALL MARKERS IN RANGE' : 'NO DATA YET'}
              </p>
            ) : (
              <div className="hud-scroll mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto pr-1 lg:max-h-none">
                {alerts.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => handleSelectMarker(m.name)}
                    className="hud-mono flex items-center justify-between gap-2 rounded-sm border px-2 py-1 text-[9px] tracking-wider transition hover:bg-white/5"
                    style={{ borderColor: `${FLAG_COLOR[m.flag]}44`, color: FLAG_COLOR[m.flag] }}
                    title={`${m.name} — click for trend`}
                  >
                    <span className="truncate">{m.name.toUpperCase()}</span>
                    <span className="shrink-0 font-bold">
                      {m.value} {m.unit} {m.flag === 'high' ? '▲' : '▼'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* bottom action bar */}
      <div className="relative z-10 shrink-0 px-3 pb-3 sm:px-5">
        {backendOffline && (
          <p className="hud-mono mx-auto mb-2 w-fit rounded-sm border border-rose-400/40 bg-rose-400/10 px-2 py-1 text-[10px] tracking-wider text-rose-300">
            ⚠ BACKEND OFFLINE — run <b>npm run dev</b>
          </p>
        )}
        <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center justify-center gap-2">
          <HudButton onClick={() => setShowIntake(true)} icon={<FileUp className="h-3 w-3" />} label="SCAN LAB" title="Upload lab reports with biomarker values (PDF / JPG / PNG)" />
          <HudButton onClick={() => reportRef.current?.click()} icon={<FileText className="h-3 w-3" />} label="CLINICAL REPORT" title="Upload a specialist visit report (neurology, cardiology…) — the AI stages it and attaches it to the right organ" disabled={processing} />
          <HudButton onClick={() => { setShowManual(true); setShowIntake(true) }} icon={<PenLine className="h-3 w-3" />} label="MANUAL +" title="Add a measurement manually (weight, blood pressure…)" />
          <HudButton onClick={() => ahRef.current?.click()} icon={<HeartPulse className="h-3 w-3" />} label="APPLE HEALTH" title={APPLE_HEALTH_TOOLTIP} disabled={processing} />
          <HudButton onClick={() => setShowResults(true)} icon={<Table2 className="h-3 w-3" />} label="RESULTS" title="Full results table + history" />
          <HudButton onClick={() => { setShowResults(true); setShowAnalysis(true) }} icon={<Sparkles className="h-3 w-3" />} label="AI ANALYSIS" title="AI general analysis of the current state" disabled={!viewed || viewed.markers.length === 0} />
          <HudButton onClick={() => setTrendOpen(true)} icon={<Activity className="h-3 w-3" />} label="TREND" title="Trend chart for the selected biomarker" disabled={!trend} />
          <HudButton onClick={() => setShowSettings(true)} icon={<Settings className="h-3 w-3" />} label="AI KEY" title="AI extraction settings (API key, endpoint, model)" />
        </div>
        <p className="hud-mono mt-2 text-center text-[8px] tracking-[0.2em] text-cyan-100/25">
          VITALS HUB · DATA STORED LOCALLY IN SQLITE · NOT A MEDICAL DEVICE
        </p>
      </div>

      {/* hidden apple-health file input (shared) */}
      <input
        ref={ahRef}
        type="file"
        accept={APPLE_HEALTH_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleAppleHealth(f)
          e.target.value = ''
        }}
      />

      {/* hidden clinical-report file input — opens the intake modal on pick */}
      <input
        ref={reportRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) {
            setShowIntake(true)
            void handleReportFiles(files)
          }
          e.target.value = ''
        }}
      />

      {/* intake modal */}
      {showIntake && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#01040c]/80 p-4 backdrop-blur-sm" onClick={() => setShowIntake(false)}>
          <div
            className="hud-scroll max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-sm border border-cyan-400/30 bg-[#020817] p-4 shadow-[0_0_60px_rgba(34,211,238,0.15)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="hud-mono text-[11px] font-semibold tracking-[0.16em] text-cyan-50">INTAKE // LAB REPORT SCANNER</h2>
                <p className="hud-mono mt-0.5 text-[9px] tracking-wider text-cyan-100/40">
                  {aiEnabled ? 'AI VISION EXTRACTION' : 'OFFLINE MODE · OCR + PARSER'}
                </p>
              </div>
              <button onClick={() => setShowIntake(false)} className="text-cyan-100/50 transition hover:text-cyan-100" aria-label="Close intake">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <UploadZone disabled={processing} onFiles={handleFiles} />
              <div className="flex flex-wrap items-center gap-2">
                <HudButton onClick={() => setShowManual((v) => !v)} icon={<PenLine className="h-3 w-3" />} label="MANUAL +" title="Add a measurement manually" />
                <HudButton onClick={() => ahRef.current?.click()} icon={<HeartPulse className="h-3 w-3" />} label="APPLE HEALTH" title={APPLE_HEALTH_TOOLTIP} disabled={processing} />
                <HudButton onClick={() => reportRef.current?.click()} icon={<FileText className="h-3 w-3" />} label="CLINICAL REPORT" title="A specialist visit report with no lab values — staged by AI and attached to an organ" disabled={processing} />
              </div>
              <p className="hud-mono text-[9px] leading-relaxed tracking-wider text-cyan-100/35">
                LAB REPORT → biomarker values and trends · CLINICAL REPORT → a specialist
                visit (neurology, cardiology…) attached to an organ with a criticality stage
              </p>
              {showManual && (
                <ManualEntryForm onSave={handleSaveManual} onClose={() => setShowManual(false)} />
              )}
              {processing && (
                <p className="hud-mono flex items-center gap-2 text-[11px] tracking-wider text-cyan-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status || 'Working…'}
                </p>
              )}
              {notice && (
                <p className="hud-mono text-[11px] tracking-wider text-emerald-300">{notice}</p>
              )}
              {reportDrafts.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="hud-mono text-[10px] tracking-[0.16em] text-cyan-50">
                    CLINICAL REPORTS // CHECK THE AI STAGING
                  </p>
                  <ReportReview
                    drafts={reportDrafts}
                    onConfirm={handleConfirmReport}
                    onDiscard={handleDiscardReport}
                    busy={processing}
                  />
                </div>
              )}
              {extractions.length > 0 && (
                <ExtractionReview results={extractions} onConfirm={handleConfirm} onDiscard={handleDiscard} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* results drawer — full table, AI analysis, history */}
      {showResults && viewed && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#01040c]/70 backdrop-blur-sm" onClick={() => setShowResults(false)}>
          <div
            className="hud-scroll h-full w-full max-w-xl overflow-y-auto border-l border-cyan-400/30 bg-[#020817] p-4 shadow-[0_0_60px_rgba(34,211,238,0.15)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="hud-mono text-[11px] font-semibold tracking-[0.16em] text-cyan-50">
                  {viewDate ? `RESULTS // ${viewed.date}` : 'CURRENT STATE // ALL MARKERS'}
                </h2>
                <p className="hud-mono mt-0.5 text-[9px] tracking-wider text-cyan-100/40">
                  {viewed.markers.length} MARKERS{viewDate ? '' : ' · LATEST VALUE OF EVERY MARKER'}
                </p>
              </div>
              <button onClick={() => setShowResults(false)} className="text-cyan-100/50 transition hover:text-cyan-100" aria-label="Close results">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {showAnalysis && (
                <PanelAnalysis
                  record={viewed}
                  onClose={() => setShowAnalysis(false)}
                  onOpenSettings={() => setShowSettings(true)}
                />
              )}
              <ResultsTable
                markers={viewed.markers}
                selected={selectedMarker}
                onSelect={handleSelectMarker}
                onDelete={handleDeleteMarker}
              />
              <HudPanel
                title="Test History"
                subtitle={`${history.length} RECORD${history.length === 1 ? '' : 'S'}`}
                right={
                  <div className="flex items-center gap-1.5">
                    <HudButton onClick={() => setViewDate(null)} icon={<Activity className="h-3 w-3" />} label="STATE" title="Back to the merged current state" disabled={!viewDate} />
                    <HudButton onClick={handleDemo} icon={<Database className="h-3 w-3" />} label="DEMO" title="Seed 3 sample tests" />
                    <HudButton onClick={() => exportHistory(history)} icon={<Download className="h-3 w-3" />} label="EXPORT" title="Download history as JSON" disabled={history.length === 0} />
                    <HudButton onClick={() => importRef.current?.click()} icon={<Upload className="h-3 w-3" />} label="IMPORT" title="Import a previously exported JSON" />
                    <HudButton onClick={handleClear} icon={<Eraser className="h-3 w-3" />} label="CLEAR" title="Delete all stored data" disabled={history.length === 0} danger />
                  </div>
                }
              >
                <HistoryList records={history} activeDate={viewDate ? (viewed?.date ?? null) : null} onPick={(d) => setViewDate(d)} />
                <input
                  ref={importRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void handleImportFile(f)
                    e.target.value = ''
                  }}
                />
              </HudPanel>
            </div>
          </div>
        </div>
      )}

      {/* trend overlay */}
      {trendOpen && trend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#01040c]/80 p-4 backdrop-blur-sm" onClick={() => setTrendOpen(false)}>
          <div
            className="w-full max-w-2xl rounded-sm border border-cyan-400/30 bg-[#020817] p-4 shadow-[0_0_60px_rgba(34,211,238,0.15)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="hud-mono text-[11px] font-semibold tracking-[0.16em] text-cyan-50">
                TREND // {trend.name.toUpperCase()} · {trend.points.length} READING{trend.points.length === 1 ? '' : 'S'}
              </h2>
              <button onClick={() => setTrendOpen(false)} className="text-cyan-100/50 transition hover:text-cyan-100" aria-label="Close trend">
                <X className="h-4 w-4" />
              </button>
            </div>
            <TrendChart name={trend.name} unit={trend.unit} refLow={trend.refLow} refHigh={trend.refHigh} points={trend.points} />
          </div>
        </div>
      )}

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onConfigChange={(cfg) => setAiEnabled(cfg.hasKey)}
        onProfileChange={(p) => setBodySex(p.sex)}
      />
    </div>
  )
}

function HudButton({
  onClick,
  icon,
  label,
  title,
  disabled,
  danger,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  title: string
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`hud-mono flex items-center gap-1 rounded-sm border px-2 py-1 text-[10px] tracking-wider transition disabled:cursor-not-allowed disabled:opacity-35 ${
        danger
          ? 'border-rose-400/40 text-rose-300/90 hover:bg-rose-400/10'
          : 'border-cyan-400/30 text-cyan-200/90 hover:bg-cyan-400/10'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
