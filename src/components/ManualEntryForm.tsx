import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import type { BiomarkerReading, Category } from '@/types/biomarker'

/**
 * Quick-add manual entry: one-tap preset chips, value field(s), datetime.
 * Reference ranges are applied automatically in the background; free-text
 * name/unit/refs live behind the Advanced toggle.
 */

interface MarkerDef {
  name: string
  unit: string
  lo: number | null
  hi: number | null
  category: Category
}

type ChipId = 'weight' | 'bp' | 'hr' | 'temp'

const CHIPS: { id: ChipId; label: string; hint: string; markers: [MarkerDef] | [MarkerDef, MarkerDef] }[] = [
  {
    id: 'weight',
    label: 'WEIGHT',
    hint: 'kg',
    markers: [{ name: 'Weight', unit: 'kg', lo: null, hi: null, category: 'Other' }],
  },
  {
    id: 'bp',
    label: 'BLOOD PRESSURE',
    hint: 'mmHg',
    markers: [
      { name: 'Blood Pressure Systolic', unit: 'mmHg', lo: 90, hi: 120, category: 'Other' },
      { name: 'Blood Pressure Diastolic', unit: 'mmHg', lo: 60, hi: 80, category: 'Other' },
    ],
  },
  {
    id: 'hr',
    label: 'HEART RATE',
    hint: 'bpm',
    markers: [{ name: 'Heart Rate', unit: 'bpm', lo: 60, hi: 100, category: 'Other' }],
  },
  {
    id: 'temp',
    label: 'TEMPERATURE',
    hint: '°C',
    markers: [{ name: 'Body Temperature', unit: '°C', lo: 36.1, hi: 37.2, category: 'Other' }],
  },
]

function computeFlag(value: number, lo: number | null, hi: number | null): BiomarkerReading['flag'] {
  if (lo === null && hi === null) return 'unknown'
  if (hi !== null && value > hi) return 'high'
  if (lo !== null && value < lo) return 'low'
  return 'normal'
}

function nowLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface ManualEntryFormProps {
  onSave: (date: string, markers: BiomarkerReading[]) => void
  onClose: () => void
}

const INPUT =
  'hud-mono w-full rounded-sm border border-cyan-400/25 bg-[#020817]/80 px-2 py-1.5 text-xs text-cyan-50 outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/60 focus:shadow-[0_0_10px_rgba(34,211,238,0.15)] [color-scheme:dark]'

export function ManualEntryForm({ onSave, onClose }: ManualEntryFormProps) {
  const [chipId, setChipId] = useState<ChipId>('weight')
  const [valueA, setValueA] = useState('') // value (or systolic for BP)
  const [valueB, setValueB] = useState('') // diastolic for BP
  const [dateTime, setDateTime] = useState(nowLocal())
  const [advanced, setAdvanced] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customUnit, setCustomUnit] = useState('')
  const [refLow, setRefLow] = useState('')
  const [refHigh, setRefHigh] = useState('')
  const [error, setError] = useState('')

  const chip = useMemo(() => CHIPS.find((c) => c.id === chipId) ?? CHIPS[0], [chipId])
  const isBp = chip.markers.length === 2

  const pick = (id: ChipId) => {
    setChipId(id)
    setValueA('')
    setValueB('')
    setError('')
  }

  const handleSubmit = () => {
    const date = dateTime.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Pick a valid date/time.')
      return
    }

    // Advanced mode: one fully custom marker
    if (advanced) {
      const v = Number(valueA)
      if (customName.trim().length < 2) {
        setError('Name is required (2+ characters).')
        return
      }
      if (!valueA.trim() || !Number.isFinite(v)) {
        setError('Value must be a number.')
        return
      }
      const lo = refLow.trim() === '' ? null : Number(refLow)
      const hi = refHigh.trim() === '' ? null : Number(refHigh)
      if ((lo !== null && !Number.isFinite(lo)) || (hi !== null && !Number.isFinite(hi))) {
        setError('Reference bounds must be numbers (or empty).')
        return
      }
      onSave(date, [{
        name: customName.trim(),
        category: 'Other',
        value: v,
        unit: customUnit.trim(),
        refLow: lo,
        refHigh: hi,
        flag: computeFlag(v, lo, hi),
      }])
      return
    }

    // Quick-add mode: preset marker(s) with automatic ranges
    const a = Number(valueA)
    if (!valueA.trim() || !Number.isFinite(a)) {
      setError(isBp ? 'Systolic value must be a number.' : 'Value must be a number.')
      return
    }
    const markers: BiomarkerReading[] = []
    const [first, second] = chip.markers
    markers.push({
      name: first.name,
      category: first.category,
      value: a,
      unit: first.unit,
      refLow: first.lo,
      refHigh: first.hi,
      flag: computeFlag(a, first.lo, first.hi),
    })
    if (second) {
      const b = Number(valueB)
      if (!valueB.trim() || !Number.isFinite(b)) {
        setError('Diastolic value must be a number.')
        return
      }
      markers.push({
        name: second.name,
        category: second.category,
        value: b,
        unit: second.unit,
        refLow: second.lo,
        refHigh: second.hi,
        flag: computeFlag(b, second.lo, second.hi),
      })
    }
    onSave(date, markers)
  }

  return (
    <div className="rounded-sm border border-cyan-400/25 bg-cyan-950/20 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="hud-label">Quick add measurement</span>
        <button onClick={onClose} className="text-cyan-100/50 transition hover:text-cyan-200" title="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* one-tap preset chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            onClick={() => pick(c.id)}
            className={`hud-mono rounded-sm border px-2.5 py-1 text-[10px] tracking-wider transition ${
              c.id === chipId && !advanced
                ? 'border-cyan-300/70 bg-cyan-400/15 text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                : 'border-cyan-400/20 text-cyan-100/60 hover:bg-cyan-400/5'
            }`}
          >
            {c.label} <span className="text-cyan-100/40">{c.hint}</span>
          </button>
        ))}
      </div>

      {advanced ? (
        /* advanced: fully custom marker */
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <label className="col-span-2">
            <span className="hud-label mb-1 block">Name *</span>
            <input className={INPUT} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Resting SpO2" />
          </label>
          <label>
            <span className="hud-label mb-1 block">Value *</span>
            <input className={INPUT} value={valueA} onChange={(e) => setValueA(e.target.value)} inputMode="decimal" placeholder="98" />
          </label>
          <label>
            <span className="hud-label mb-1 block">Unit</span>
            <input className={INPUT} value={customUnit} onChange={(e) => setCustomUnit(e.target.value)} placeholder="%" />
          </label>
          <label>
            <span className="hud-label mb-1 block">Ref low</span>
            <input className={INPUT} value={refLow} onChange={(e) => setRefLow(e.target.value)} inputMode="decimal" placeholder="optional" />
          </label>
          <label>
            <span className="hud-label mb-1 block">Ref high</span>
            <input className={INPUT} value={refHigh} onChange={(e) => setRefHigh(e.target.value)} inputMode="decimal" placeholder="optional" />
          </label>
        </div>
      ) : (
        /* quick-add: value field(s) only */
        <div className="grid grid-cols-2 gap-2.5">
          <label>
            <span className="hud-label mb-1 block">
              {isBp ? `Systolic * (${chip.markers[0].unit})` : `Value * (${chip.markers[0].unit})`}
            </span>
            <input
              className={INPUT}
              value={valueA}
              onChange={(e) => setValueA(e.target.value)}
              inputMode="decimal"
              placeholder={isBp ? '120' : chip.id === 'weight' ? '70.5' : chip.id === 'hr' ? '68' : '36.6'}
              autoFocus
            />
          </label>
          {isBp ? (
            <label>
              <span className="hud-label mb-1 block">Diastolic * ({chip.markers[1]?.unit ?? 'mmHg'})</span>
              <input className={INPUT} value={valueB} onChange={(e) => setValueB(e.target.value)} inputMode="decimal" placeholder="80" />
            </label>
          ) : (
            <div className="flex items-end pb-1.5">
              <span className="hud-mono text-[10px] tracking-wider text-cyan-100/35">
                range applied automatically
              </span>
            </div>
          )}
        </div>
      )}

      {/* date/time + save */}
      <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
        <label className="min-w-44 flex-1">
          <span className="hud-label mb-1 block">When</span>
          <input type="datetime-local" className={INPUT} value={dateTime} onChange={(e) => setDateTime(e.target.value)} />
        </label>
        <button
          onClick={handleSubmit}
          className="hud-mono flex items-center justify-center gap-1.5 rounded-sm border border-emerald-400/50 bg-emerald-400/10 px-4 py-1.5 text-[11px] tracking-wider text-emerald-300 transition hover:bg-emerald-400/20"
        >
          <Plus className="h-3.5 w-3.5" /> SAVE
        </button>
      </div>

      {error && <p className="hud-mono mt-2 text-[11px] text-rose-300">{error}</p>}

      <button
        onClick={() => {
          setAdvanced((v) => !v)
          setError('')
        }}
        className="hud-mono mt-2.5 flex items-center gap-1 text-[9px] tracking-wider text-cyan-400/60 transition hover:text-cyan-300"
      >
        {advanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        ADVANCED · custom name, unit & reference range
      </button>
      <p className="hud-mono mt-1.5 text-[9px] tracking-wider text-cyan-100/35">
        Saved into the record for that date (source: Manual entry). Re-saving the same name on the same date overwrites it.
      </p>
    </div>
  )
}
