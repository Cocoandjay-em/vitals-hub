import type { Category, Flag, ParsedBiomarker } from '@/types/biomarker'

/* ------------------------------------------------------------------ */
/* Known biomarker dictionary: name aliases -> canonical + category    */
/* English + Italian aliases.                                           */
/* ------------------------------------------------------------------ */

interface KnownMarker {
  canonical: string
  category: Category
  aliases: string[]
}

const KNOWN: KnownMarker[] = [
  // CBC
  { canonical: 'Hemoglobin', category: 'CBC', aliases: ['hemoglobin', 'hgb', 'hb', 'haemoglobin', 'emoglobina'] },
  { canonical: 'Hematocrit', category: 'CBC', aliases: ['hematocrit', 'hct', 'haematocrit', 'pcv', 'ematocrito', 'hct(pcv)', 'hct (pcv)'] },
  { canonical: 'WBC', category: 'CBC', aliases: ['wbc', 'white blood cell', 'white blood cells', 'leukocytes', 'leucocytes', 'white cell count', 'globuli bianchi', 'leucociti'] },
  { canonical: 'RBC', category: 'CBC', aliases: ['rbc', 'red blood cell', 'red blood cells', 'erythrocytes', 'red cell count', 'globuli rossi', 'eritrociti'] },
  { canonical: 'Platelets', category: 'CBC', aliases: ['platelets', 'platelet count', 'plt', 'piastrine'] },
  { canonical: 'MCV', category: 'CBC', aliases: ['mcv', 'mean corpuscular volume', 'volume corpuscolare medio'] },
  { canonical: 'MCH', category: 'CBC', aliases: ['mch'] },
  { canonical: 'MCHC', category: 'CBC', aliases: ['mchc'] },
  { canonical: 'RDW', category: 'CBC', aliases: ['rdw', 'red cell distribution width'] },
  { canonical: 'MPV', category: 'CBC', aliases: ['mpv', 'mean platelet volume'] },
  { canonical: 'Neutrophils', category: 'CBC', aliases: ['neutrophils', 'neutrophils abs', 'absolute neutrophils', 'neut', 'neutrofili'] },
  { canonical: 'Lymphocytes', category: 'CBC', aliases: ['lymphocytes', 'lymphs', 'lymph', 'linfociti'] },
  { canonical: 'Monocytes', category: 'CBC', aliases: ['monocytes', 'mono', 'monociti'] },
  { canonical: 'Eosinophils', category: 'CBC', aliases: ['eosinophils', 'eos', 'eosinofili'] },
  { canonical: 'Basophils', category: 'CBC', aliases: ['basophils', 'baso', 'basofili'] },
  // Lipids
  { canonical: 'Total Cholesterol', category: 'Lipids', aliases: ['cholesterol, total', 'cholesterol (total)', 'total cholesterol', 'cholesterol total', 'cholesterol', 'colesterolo totale', 'colesterolo'] },
  { canonical: 'HDL Cholesterol', category: 'Lipids', aliases: ['hdl cholesterol', 'hdl-c', 'hdl', 'hdl chol', 'colesterolo hdl'] },
  { canonical: 'LDL Cholesterol', category: 'Lipids', aliases: ['ldl cholesterol', 'ldl-c', 'ldl', 'ldl chol', 'ldl calc', 'colesterolo ldl'] },
  { canonical: 'Triglycerides', category: 'Lipids', aliases: ['triglycerides', 'trig', 'tg', 'trigliceridi'] },
  { canonical: 'Non-HDL Cholesterol', category: 'Lipids', aliases: ['non-hdl cholesterol', 'non hdl', 'non-hdl', 'colesterolo non hdl'] },
  { canonical: 'ApoB', category: 'Lipids', aliases: ['apob', 'apolipoprotein b', 'apolipoproteina b'] },
  // Metabolic / Glucose
  { canonical: 'Glucose', category: 'Glucose', aliases: ['glucose', 'fasting glucose', 'glucose fasting', 'blood glucose', 'glu', 'glicemia', 'glucosio'] },
  { canonical: 'HbA1c', category: 'Glucose', aliases: ['hba1c', 'hemoglobin a1c', 'glycated hemoglobin', 'a1c', 'hb a1c', 'emoglobina glicata', 'emoglobina glicosilata'] },
  { canonical: 'Insulin', category: 'Glucose', aliases: ['insulin', 'fasting insulin', 'insulina', 'insulinemia'] },
  { canonical: 'Sodium', category: 'Metabolic', aliases: ['sodium', 'na', 'sodio'] },
  { canonical: 'Potassium', category: 'Metabolic', aliases: ['potassium', 'k', 'potassio'] },
  { canonical: 'Chloride', category: 'Metabolic', aliases: ['chloride', 'cl', 'cloro'] },
  { canonical: 'Calcium', category: 'Metabolic', aliases: ['calcium', 'ca', 'calcio'] },
  { canonical: 'Magnesium', category: 'Metabolic', aliases: ['magnesium', 'mg', 'magnesio'] },
  { canonical: 'Phosphorus', category: 'Metabolic', aliases: ['phosphorus', 'phosphate', 'fosforo', 'fosfato'] },
  { canonical: 'Bicarbonate', category: 'Metabolic', aliases: ['bicarbonate', 'co2', 'carbon dioxide', 'bicarbonato'] },
  // Kidney
  { canonical: 'Urea', category: 'Kidney', aliases: ['urea', 'bun', 'blood urea nitrogen', 'urea nitrogen', 'azotemia'] },
  { canonical: 'Creatinine', category: 'Kidney', aliases: ['creatinine', 'creat', 'creatinina'] },
  { canonical: 'eGFR', category: 'Kidney', aliases: ['egfr', 'estimated gfr', 'gfr', 'filtrato glomerulare'] },
  { canonical: 'Uric Acid', category: 'Kidney', aliases: ['uric acid', 'urate', 'acido urico', 'uricemia'] },
  // Liver
  { canonical: 'Albumin', category: 'Liver', aliases: ['albumin', 'alb', 'albumina'] },
  { canonical: 'Total Protein', category: 'Liver', aliases: ['total protein', 'protein, total', 'protein total', 'proteine totali', 'protidemia'] },
  { canonical: 'Bilirubin Total', category: 'Liver', aliases: ['bilirubin total', 'total bilirubin', 'bilirubin, total', 'bilirubin', 'bilirubina totale', 'bilirubina'] },
  { canonical: 'ALT', category: 'Liver', aliases: ['alt', 'sgpt', 'alanine aminotransferase', 'alanine transaminase', 'gpt', 'alt (gpt)', 'transaminasi gpt', 'alanina aminotransferasi', 'alanine aminotransferase)'] },
  { canonical: 'AST', category: 'Liver', aliases: ['ast', 'sgot', 'aspartate aminotransferase', 'aspartate transaminase', 'got', 'ast (got)', 'transaminasi got', 'aspartato aminotransferasi'] },
  { canonical: 'ALP', category: 'Liver', aliases: ['alp', 'alkaline phosphatase', 'alk phos', 'fosfatasi alcalina'] },
  { canonical: 'GGT', category: 'Liver', aliases: ['ggt', 'gamma gt', 'gamma-glutamyl transferase', 'gamma glutamyl transferase', 'gamma glutamil transferasi'] },
  { canonical: 'LDH', category: 'Liver', aliases: ['ldh', 'lactate dehydrogenase', 'lattico deidrogenasi'] },
  // Thyroid
  { canonical: 'TSH', category: 'Thyroid', aliases: ['tsh', 'thyroid stimulating hormone', 'thyrotropin', 'ormone tireostimolante', 'tireotropina'] },
  { canonical: 'Free T4', category: 'Thyroid', aliases: ['free t4', 'ft4', 't4, free', 't4 free', 'tiroxina libera', 't4 libero'] },
  { canonical: 'Free T3', category: 'Thyroid', aliases: ['free t3', 'ft3', 't3, free', 't3 free', 'triiodotironina libera', 't3 libero'] },
  { canonical: 'T4', category: 'Thyroid', aliases: ['t4', 'thyroxine', 'tiroxina'] },
  { canonical: 'T3', category: 'Thyroid', aliases: ['t3', 'triiodothyronine', 'triiodotironina'] },
  // Vitamins
  { canonical: 'Vitamin D', category: 'Vitamins', aliases: ['vitamin d', '25-oh vitamin d', '25-hydroxyvitamin d', 'vitamin d 25-hydroxy', '25(oh)d', 'vitamina d', '25 oh vitamina d', '25-oh vitamina d'] },
  { canonical: 'Vitamin B12', category: 'Vitamins', aliases: ['vitamin b12', 'b12', 'cobalamin', 'vitamina b12', 'cobalamina'] },
  { canonical: 'Folate', category: 'Vitamins', aliases: ['folate', 'folic acid', 'vitamin b9', 'folati', 'acido folico', 'folatemia'] },
  { canonical: 'Ferritin', category: 'Vitamins', aliases: ['ferritin', 'ferritina'] },
  { canonical: 'Iron', category: 'Vitamins', aliases: ['iron', 'serum iron', 'fe', 'ferro', 'sideremia'] },
  { canonical: 'TIBC', category: 'Vitamins', aliases: ['tibc', 'total iron binding capacity', 'capacità totale legante il ferro'] },
  { canonical: 'Transferrin Saturation', category: 'Vitamins', aliases: ['transferrin saturation', 'tsat', 'saturazione transferrina'] },
  // Hormones
  { canonical: 'Testosterone', category: 'Hormones', aliases: ['testosterone', 'total testosterone'] },
  { canonical: 'Estradiol', category: 'Hormones', aliases: ['estradiol', 'e2', 'estradiolo'] },
  { canonical: 'Cortisol', category: 'Hormones', aliases: ['cortisol', 'cortisolo'] },
  { canonical: 'DHEA-S', category: 'Hormones', aliases: ['dhea-s', 'dheas', 'dhea sulfate'] },
  { canonical: 'Prolactin', category: 'Hormones', aliases: ['prolactin', 'prolattina'] },
  // Inflammation
  { canonical: 'CRP', category: 'Inflammation', aliases: ['crp', 'c-reactive protein', 'c reactive protein', 'pcr', 'proteina c reattiva'] },
  { canonical: 'hs-CRP', category: 'Inflammation', aliases: ['hs-crp', 'hscrp', 'high sensitivity crp', 'hs crp', 'hs-pcr', 'pcr ultrasensibile', 'pcr ad alta sensibilita'] },
  { canonical: 'ESR', category: 'Inflammation', aliases: ['esr', 'erythrocyte sedimentation rate', 'sed rate', 'ves', 'velocita di sedimentazione', 'velocita di eritrosedimentazione'] },
  { canonical: 'Homocysteine', category: 'Inflammation', aliases: ['homocysteine', 'omocisteina', 'omocisteinemia'] },
]

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents (velocità -> velocita)
    .replace(/[,.()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Longest alias first so "colesterolo totale" wins over "colesterolo"
const ALIAS_INDEX: Array<{ alias: string; canonical: string; category: Category }> = KNOWN
  .flatMap((k) => k.aliases.map((alias) => ({ alias: normName(alias), canonical: k.canonical, category: k.category })))
  .sort((a, b) => b.alias.length - a.alias.length)

const CATEGORY_KEYWORDS: Array<[Category, RegExp]> = [
  ['CBC', /\b(wbc|rbc|hemoglobin|haemoglobin|emoglobina|hematocrit|ematocrito|platelet|piastrin|mcv|mch|mchc|rdw|mpv|neutrophil|neutrofili|lymphocyte|linfociti|monocyte|monociti|eosinophil|eosinofili|basophil|basofili|leukocyte|leucociti|erythrocyte|eritrociti|globuli)\b/i],
  ['Lipids', /\b(cholesterol|colesterolo|hdl|ldl|triglyceride|trigliceridi|lipid|apob|lipoprotein)\b/i],
  ['Glucose', /\b(glucose|glucosio|glicemia|glicata|hba1c|a1c|insulin|glyc)\b/i],
  ['Thyroid', /\b(tsh|thyroid|tiroide|thyroxine|tiroxina|triiodothyronine|triiodotironina|t3|t4)\b/i],
  ['Liver', /\b(alt|ast|alp|ggt|bilirubin|bilirubina|albumin|liver|hepatic|epatic|sgot|sgpt|got|gpt|transaminas|ldh)\b/i],
  ['Kidney', /\b(creatinine|creatinina|egfr|gfr|urea|bun|azotemia|uric|kidney|renal)\b/i],
  ['Vitamins', /\b(vitamin|vitamina|ferritin|folate|folati|iron|ferro|sideremia|b12|tibc)\b/i],
  ['Hormones', /\b(testosterone|estradiol|cortisol|cortisolo|prolactin|prolattina|dhea|hormone|ormone|fsh|lh|progesterone)\b/i],
  ['Inflammation', /\b(crp|pcr|esr|ves|sedimentation|sedimentazione|homocysteine|omocisteina|inflammation)\b/i],
  ['Metabolic', /\b(sodium|sodio|potassium|potassio|chloride|cloro|calcium|calcio|magnesium|magnesio|phosph|bicarbonate|bicarbonato|electrolyte|elettroliti)\b/i],
]

function categorize(name: string): Category {
  const lower = normName(name)
  for (const k of KNOWN) {
    if (k.aliases.some((a) => lower.includes(normName(a)))) return k.category
  }
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(name)) return cat
  }
  return 'Other'
}

/* ------------------------------------------------------------------ */
/* Line normalisation                                                  */
/* ------------------------------------------------------------------ */

// number with optional thousands grouping + decimal separator (either style)
// "13.5", "13,5", "1,234.5" (US), "1.234,5" (IT)
const NUM = String.raw`-?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)`

function normalizeLine(line: string): string {
  return (
    line
      .replace(/[–—−]/g, '-')
      .replace(/[÷]/g, '-')
      .replace(/[×✕]/g, 'x')
      .replace(/[≤]/g, '<=')
      .replace(/[≥]/g, '>=')
      .replace(/=>/g, '>=')
      .replace(/=</g, '<=')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      // Italian range phrases -> symbols ("fino a 200", "inferiore a 5", "superiore a 40", "da 12 a 15,5")
      .replace(/\b(?:fino\s+a|inferiore\s+(?:a|di)|non\s+superiore\s+(?:a|di)|entro)\s+/gi, '< ')
      .replace(/\b(?:superiore\s+(?:a|di)|maggiore\s+(?:a|di)|oltre)\s+/gi, '> ')
      .replace(new RegExp(String.raw`\bda\s+(${NUM})\s+a\s+(${NUM})`, 'gi'), '$1-$2')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

// range at END of line: lo-hi / lo - hi / lo/hi / <hi / >lo / <=hi / >=lo,
// optionally wrapped in () or [], optionally followed by a method/comment tail
// (e.g. "4-11 Impedance", "80.0-100.0 Derived from RBC", "<5.18 |")
const RANGE_RE = new RegExp(
  String.raw`[(\[]?\s*(?:(${NUM})\s*[-/]\s*(${NUM})|(<|>|<=|>=)\s*(${NUM}))\s*[)\]]?\s*\|?\s*(?:[A-Za-z][A-Za-z0-9 .()/+|'-]{0,45}?)?\s*\|?\s*\.?\s*$`,
)
// a line that is ONLY a range (multi-column PDFs where the range column
// extracts as its own line) — strict, no tail allowed
const STRICT_RANGE_ONLY_RE = new RegExp(
  String.raw`^\s*[(\[]?\s*(?:${NUM}\s*[-/]\s*${NUM}|[<>]=?\s*${NUM})\s*[)\]]?\s*$`,
)
// labeled classification range anywhere in a line, label colon optional:
// "Desirable: <5.18", "Normal:4.0-5.6", "Optimal 30 - 100", "High Risk: <1.00"
const LABELED_RANGE_RE = new RegExp(
  String.raw`([A-Za-z][A-Za-z ]{1,25}?):?\s*(?:(${NUM})\s*[-/]\s*(${NUM})|(<|>|<=|>=)\s*(${NUM}))`,
)
const FLAG_TOKEN_RE = /\s+\(?([HLNA*]{1,3}|high|low|alto|alta|basso|bassa)\)?\.?$/i
const FLAG_WORD_RE = /^\(?(h|l|n|high|low|alto|alta|basso|bassa)\)?$/i
const UNIT_RE = /^[a-zA-Z0-9μµ°%/.*^()\\-]{1,20}$/

function flagFromWord(word: string): Flag | null {
  const w = word.replace(/[()]/g, '').toLowerCase()
  if (w === 'h' || w === 'high' || w === 'alto' || w === 'alta') return 'high'
  if (w === 'l' || w === 'low' || w === 'basso' || w === 'bassa') return 'low'
  return null
}

function toNumber(raw: string): number {
  let s = raw.trim()
  const hasDot = s.includes('.')
  const hasComma = s.includes(',')
  if (hasDot && hasComma) {
    // both separators: the LAST one is the decimal mark, the other is thousands
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    s = s.replace(',', '.')
  }
  return parseFloat(s)
}

interface RangeBounds {
  refLow: number | null
  refHigh: number | null
}

function bounds(lo: number | null, hi: number | null): RangeBounds | null {
  if (lo !== null && (!Number.isFinite(lo) || (hi !== null && lo >= hi))) return null
  if (hi !== null && !Number.isFinite(hi)) return null
  return { refLow: lo, refHigh: hi }
}

function parseRangeTail(line: string): { rest: string } & RangeBounds {
  const m = line.match(RANGE_RE)
  if (!m) return { rest: line, refLow: null, refHigh: null }
  const rest = line.slice(0, m.index).trim()
  if (m[1] !== undefined && m[2] !== undefined) {
    const b = bounds(toNumber(m[1]), toNumber(m[2]))
    if (b) return { rest, ...b }
    return { rest: line, refLow: null, refHigh: null }
  }
  const op = m[3] ?? ''
  const bound = m[4] !== undefined ? toNumber(m[4]) : null
  if (bound === null || !Number.isFinite(bound)) return { rest: line, refLow: null, refHigh: null }
  if (op === '<' || op === '<=') return { rest, refLow: null, refHigh: bound }
  return { rest, refLow: bound, refHigh: null }
}

/** First labeled classification range in a line ("Desirable: <5.18", "Optimal 30 - 100"). */
function searchLabeledRange(line: string): ({ index: number; label: string } & RangeBounds) | null {
  const m = line.match(LABELED_RANGE_RE)
  if (!m || m.index === undefined) return null
  const label = (m[1] ?? '').trim()
  if (m[2] !== undefined && m[3] !== undefined) {
    const b = bounds(toNumber(m[2]), toNumber(m[3]))
    return b ? { index: m.index, label, ...b } : null
  }
  const op = m[4] ?? ''
  const bound = m[5] !== undefined ? toNumber(m[5]) : null
  if (bound === null || !Number.isFinite(bound)) return null
  if (op === '<' || op === '<=') return { index: m.index, label, refLow: null, refHigh: bound }
  return { index: m.index, label, refLow: bound, refHigh: null }
}

interface NameValueParts {
  name: string
  value: number
  unit: string
  flagHint: Flag | null
}

/** Split "name value [flag word] [unit]" from the remainder after the range was stripped. */
function parseNameValue(rest: string): NameValueParts | null {
  // strip a trailing lab flag token like "H", "L", "(H)", "N", "High", "Low"
  const body = rest.replace(FLAG_TOKEN_RE, (match, _tok: string, offset: number) => {
    return /[0-9]/.test(rest.slice(0, offset)) ? '' : match
  })

  const matches = [...body.matchAll(new RegExp(`(${NUM})`, 'g'))]
  if (matches.length === 0) return null

  // choose the first number that is not part of the name (names may contain digits: B12, T4…)
  let chosen: RegExpMatchArray | null = null
  for (const m of matches) {
    const before = body.slice(0, m.index)
    const after = body.slice((m.index ?? 0) + m[0].length)
    const prevChar = before.slice(-1)
    // skip numbers glued to letters/parens (B12, T4, "(25")
    if (/[A-Za-z0-9(]/.test(prevChar)) continue
    const afterTrim = after.trimStart()
    // number glued to a hyphenated word fragment, e.g. the "25" in "25-Hydroxy"
    if (/^-[A-Za-z]/.test(afterTrim)) continue
    // leading row index/sequence number: "3 White Cell Count 7.9 …"
    if (before.trim() === '' && /^[A-Za-z]/.test(afterTrim)) continue
    let unitCandidate = afterTrim.split(/\s+/)[0] ?? ''
    // a lone H / L / N / High / Low token after the value is a lab flag, not a unit
    if (FLAG_WORD_RE.test(unitCandidate)) {
      const tokens = afterTrim.split(/\s+/).slice(1)
      unitCandidate = tokens[0] ?? ''
    }
    if (unitCandidate && !UNIT_RE.test(unitCandidate) && !/^[-(<[]/.test(afterTrim)) continue
    chosen = m
    break
  }
  if (!chosen || chosen.index === undefined) return null

  let name = body.slice(0, chosen.index).replace(/[:.\s]+$/, '').trim()
  // strip leading row markers: "# AST …", "3 White Cell Count …"
  name = name.replace(/^[#*§+•·▪◦\s]+/, '').replace(/^\d{1,3}\s+(?=[A-Za-z])/, '')
  const value = toNumber(chosen[0])
  if (name.length < 2 || !/[A-Za-z]/.test(name) || name.length > 60) return null
  if (!Number.isFinite(value)) return null

  const rawTokens = body.slice(chosen.index + chosen[0].length).trim().split(/\s+/).filter(Boolean)
  // pull out a flag word (High/Low/H/L…) sitting between value and unit
  let flagHint: Flag | null = null
  const tokens: string[] = []
  for (const t of rawTokens) {
    if (flagHint === null && tokens.length === 0 && FLAG_WORD_RE.test(t)) {
      flagHint = flagFromWord(t)
      continue
    }
    tokens.push(t)
  }
  let unitToken = tokens[0] ?? ''
  // split unit fragments: "10" + "/uL" (superscript lost: "10*9/uL" -> "10 /uL")
  if (/^\d+$/.test(unitToken) && (tokens[1] ?? '').startsWith('/')) {
    unitToken = unitToken + tokens[1]
  }
  const unit = UNIT_RE.test(unitToken) && /[a-zA-Z%μ]/.test(unitToken) ? unitToken : ''

  return { name, value, unit, flagHint }
}

function computeFlag(value: number, refLow: number | null, refHigh: number | null): Flag {
  if (refLow === null && refHigh === null) return 'unknown'
  if (refHigh !== null && value > refHigh) return 'high'
  if (refLow !== null && value < refLow) return 'low'
  return 'normal'
}

const NORMAL_BAND_LABEL_RE = /normal|optimal|desirable/i

const SKIP_LINE_RE =
  /^(page\s+\d|pagina\s+\d|patient|paziente|specimen|campion|ordered|physician|medico|lab(oratory)?\b|laboratorio|report|referto|test\s+result|name\s+value|result\s+reference|reference\s+range|valori\s+di\s+riferimento|valore\s+di\s+riferimento|riferimento|esame\s+risult|esame\s+valore|risultat[oi]\s+(unit|rifer)|units?\b|u\.m\.?\b|end of|printed|stampato|performing|medical director|collected|collection|drawn|received|receiving|reported|performed|eseguito|authori[sz]ed|instant|method|note|caution|clinical interpretation|for person|the us national|date\b|data\b|^\d+$)/i

export function parseBiomarkers(text: string): ParsedBiomarker[] {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter((l) => l.length >= 2)
  const out: ParsedBiomarker[] = []
  const hints: Array<Flag | null> = []
  const seen = new Set<string>()

  for (const rawLine of lines) {
    if (SKIP_LINE_RE.test(rawLine)) continue
    const line = rawLine.replace(/^[*•·▪◦]\s*/, '')

    // --- 1) end-anchored range (standard rows, method tails, "<5.18 |") ---
    const tail = parseRangeTail(line)

    // --- range-only line: attach to nearest previous row lacking a range ---
    if (tail.rest === '' && (tail.refLow !== null || tail.refHigh !== null)) {
      if (STRICT_RANGE_ONLY_RE.test(line)) {
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].refLow === null && out[i].refHigh === null) {
            out[i].refLow = tail.refLow
            out[i].refHigh = tail.refHigh
            out[i].flag = hints[i] ?? computeFlag(out[i].value, tail.refLow, tail.refHigh)
            out[i].sourceLine += '  +  ' + rawLine
            break
          }
        }
      }
      continue
    }

    // --- 2) parse name + value from what precedes the range ---
    let parts = parseNameValue(tail.rest)
    let refLow = tail.refLow
    let refHigh = tail.refHigh

    // --- 3) no end range: try a labeled mid-line classification range ---
    if (parts && refLow === null && refHigh === null) {
      const labeled = searchLabeledRange(line)
      if (labeled && labeled.index > 0) {
        const beforeRange = line.slice(0, labeled.index).trim()
        const p2 = parseNameValue(beforeRange)
        if (p2) {
          parts = p2
          refLow = labeled.refLow
          refHigh = labeled.refHigh
        }
      }
    }

    if (!parts) {
      // --- 4) continuation of a classification block ("| Optimal 30 - 100") ---
      // gated: only touch the previous row if its own line carried a labeled range
      if (out.length > 0 && out[out.length - 1].sourceLine.includes(':')) {
        const labeled = searchLabeledRange(line)
        if (labeled) {
          const prev = out[out.length - 1]
          const prevHint = hints[out.length - 1]
          const prevHasRange = prev.refLow !== null || prev.refHigh !== null
          if (NORMAL_BAND_LABEL_RE.test(labeled.label) || !prevHasRange) {
            prev.refLow = labeled.refLow
            prev.refHigh = labeled.refHigh
            prev.flag = prevHint ?? computeFlag(prev.value, labeled.refLow, labeled.refHigh)
            prev.sourceLine += '  +  ' + rawLine
          }
        }
      }
      continue
    }

    // Require a reference range OR a recognised marker name to keep noise down
    const lowerName = normName(parts.name)
    const known = ALIAS_INDEX.find(
      (a) => lowerName === a.alias || lowerName.startsWith(a.alias + ' ') || lowerName.endsWith(' ' + a.alias),
    )
    const hasRange = refLow !== null || refHigh !== null
    if (!known && !hasRange) continue

    // differential percentages ("Neutrophils %") coexist with absolute counts
    let canonical = known ? known.canonical : parts.name
    if (known && /%\s*$/.test(parts.name) && !canonical.endsWith('%')) canonical += ' %'
    const key = canonical.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      name: canonical,
      category: known ? known.category : categorize(parts.name),
      value: parts.value,
      unit: parts.unit,
      refLow,
      refHigh,
      // the lab's own printed flag (High/Low) wins over the computed one
      flag: parts.flagHint ?? computeFlag(parts.value, refLow, refHigh),
      sourceLine: rawLine,
    })
    hints.push(parts.flagHint)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Date detection (English + Italian)                                  */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, gen: 0, gennaio: 0,
  feb: 1, february: 1, febbraio: 1,
  mar: 2, march: 2, marzo: 2,
  apr: 3, april: 3, aprile: 3,
  may: 4, mag: 4, maggio: 4,
  jun: 5, june: 5, giu: 5, giugno: 5,
  jul: 6, july: 6, lug: 6, luglio: 6,
  aug: 7, august: 7, ago: 7, agosto: 7,
  sep: 8, sept: 8, september: 8, set: 8, settembre: 8,
  oct: 9, october: 9, ott: 9, ottobre: 9,
  nov: 10, november: 10, novembre: 10,
  dec: 11, december: 11, dic: 11, dicembre: 11,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m, d))
  if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

const DATE_PATTERNS: Array<{ re: RegExp; pick: (m: RegExpMatchArray) => string | null }> = [
  {
    // 2024-03-15 / 2024/03/15 (ISO — unambiguous)
    re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    pick: (m) => validDate(+m[1], +m[2] - 1, +m[3]),
  },
  {
    // 15 Mar 2024 / 15-mar-2024 / 15 marzo 2024
    re: /\b(\d{1,2})[-\s.]([A-Za-z]{3,9})[-\s.,]+(\d{4})\b/,
    pick: (m) => {
      const mon = MONTHS[m[2].toLowerCase()]
      return mon === undefined ? null : validDate(+m[3], mon, +m[1])
    },
  },
  {
    // Mar 15, 2024 / marzo 15, 2024
    re: /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[-\s.,]+(\d{4})\b/,
    pick: (m) => {
      const mon = MONTHS[m[1].toLowerCase()]
      return mon === undefined ? null : validDate(+m[3], mon, +m[2])
    },
  },
  {
    // 15/03/2024 or 03/15/2024 — day-first when unambiguous OR ambiguous
    // (Italian reports are DD/MM/YYYY; ISO lines never reach this pattern)
    re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/,
    pick: (m) => {
      const a = +m[1]
      const b = +m[2]
      const y = +m[3]
      if (a > 12 && b <= 12) return validDate(y, b - 1, a)
      if (b > 12 && a <= 12) return validDate(y, a - 1, b)
      return validDate(y, b - 1, a) // ambiguous: day-first
    },
  },
  {
    // 15/03/24 (two-digit year) — day-first
    re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/,
    pick: (m) => {
      const a = +m[1]
      const b = +m[2]
      const y = 2000 + +m[3]
      if (a > 12 && b <= 12) return validDate(y, b - 1, a)
      return validDate(y, b - 1, a)
    },
  },
]

export function detectTestDate(text: string): string | null {
  const lines = text.split(/\r?\n/)
  const KEYWORD_RE =
    /\b(collection\s+date|collected|date|drawn|reported|received|receiving|sample[d]?\s*(?:on|date)|performed|specimen\s+date|data\s*(?:del|di)?\s*(?:prelievo|referto|esame|accettazione)|prelievo|referto|accettazione|eseguito|data)\b/i
  // never treat a date-of-birth line as the test date
  const BIRTH_RE = /\b(nascita|nato|nata|birth|dob)\b/i

  const findIn = (line: string): string | null => {
    for (const p of DATE_PATTERNS) {
      const m = line.match(p.re)
      if (m) {
        const iso = p.pick(m)
        if (iso) return iso
      }
    }
    return null
  }

  // 1) highest priority: an explicit "collection date" line
  for (const line of lines) {
    if (BIRTH_RE.test(line)) continue
    if (/\b(collection\s+date|data\s+(?:del\s+)?prelievo)\b/i.test(line)) {
      const iso = findIn(line)
      if (iso) return iso
    }
  }
  // 2) dates on lines containing a date-ish keyword
  for (const line of lines) {
    if (!KEYWORD_RE.test(line) || BIRTH_RE.test(line)) continue
    const iso = findIn(line)
    if (iso) return iso
  }
  // 3) fall back to the first date anywhere in the document
  for (const p of DATE_PATTERNS) {
    const m = text.match(p.re)
    if (m) {
      const iso = p.pick(m)
      if (iso) return iso
    }
  }
  return null
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
