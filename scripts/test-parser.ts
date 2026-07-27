import { parseBiomarkers, detectTestDate } from '@/lib/parser'

function show(label: string, text: string) {
  console.log(`=== ${label} ===`)
  const rows = parseBiomarkers(text)
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(22)} ${String(r.value).padStart(7)} ${r.unit.padEnd(8)} [${r.refLow ?? '—'}, ${r.refHigh ?? '—'}] ${r.flag}  (${r.category})`,
    )
  }
  console.log('date:', detectTestDate(text), '| total:', rows.length)
  console.log()
  return rows
}

// 1) English baseline
show('english baseline', `
QUEST DIAGNOSTICS                    Patient: DEMO, JANE
Date collected: 03/15/2024           Reported: 03/17/2024
Test Name            Result     Units      Reference Range
Hemoglobin           13.5       g/dL       12.0 - 15.5
WBC                  6.5        10*9/L     (4.0-10.0)
Cholesterol, Total   210        mg/dL      <200
HDL Cholesterol      48         mg/dL      >40
Vitamin D 25-Hydroxy 24.2       ng/mL      30.0-100.0
Hemoglobin A1c       5.7        %          4.0-5.6
`)

// 2) Italian report with comma decimals
show('italian comma decimals', `
LABORATORIO ANALISI CENTRALE
Paziente: ROSSI MARIO   Data di nascita: 01/01/1980
Data prelievo: 15/03/2025
Esame                  Risultato  U.M.      Valori di riferimento
Emoglobina             13,5       g/dL      12,0 - 15,5
Globuli bianchi        6,5        10*9/L    4,0-10,0
Piastrine              231        10*9/L    150-400
Glicemia               5,6        mmol/L    3,9-5,5
Colesterolo totale     210        mg/dL     < 200
Colesterolo HDL        48         mg/dL     > 40
Trigliceridi           182        mg/dL     < 150
Creatinina             0,88       mg/dL     0,70-1,30
Transaminasi ALT (GPT) 41         U/L       7-45
TSH                    2,8        mIU/L     0,40-4,20
Vitamina D             24,2       ng/mL     30,0-100,0
Ferritina              58         ng/mL     20-250
PCR                    3,8        mg/L      fino a 5
Azotemia               42         mg/dL     15-50
`)

// 3) Italian range phrases + da..a + ÷
show('italian range phrases', `
Data referto: 02/11/2025
Colesterolo LDL 132 mg/dL inferiore a 100
Emoglobina 14,1 g/dL da 12,0 a 15,5
Sodio 141 mmol/L 135÷145
Potassio 5,9 mmol/L 3,5-5,1
VES 18 mm/h inferiore a 20
`)

// 4) range on a separate fragment (multi-column PDF) — attach-back
show('range-only fragments', `
Hemoglobin 13.5 g/dL
12.0 - 15.5
WBC 6.5 10*9/L
4.0 - 10.0
Glucose 101 mg/dL 70-99
`)

// 5) range with trailing unit + spaced comparator
show('range with trailing unit', `
Hemoglobin 13.5 g/dL 12.0-15.5 g/dL
Creatinine 0.88 mg/dL (0.70-1.30) mg/dL
Cholesterol 210 mg/dL < 200 mg/dL
`)

// 6) thousands separators both styles
show('thousands separators', `
Piastrine 1.234 10*9/L 150-400
Ferritin 1,234.5 ng/mL 20-250
`)

// 7) ambiguous dates: day-first now (Italian reports)
show('dates', `
Data: 03/04/2025
Hemoglobin 13.5 g/dL 12.0-15.5
`)
show('italian month date', `
Referto del 15 marzo 2025
Hemoglobin 13.5 g/dL 12.0-15.5
`)
show('birthdate excluded', `
Data di nascita: 01/01/1980
Data prelievo: 20/05/2025
Hemoglobin 13.5 g/dL 12.0-15.5
`)
