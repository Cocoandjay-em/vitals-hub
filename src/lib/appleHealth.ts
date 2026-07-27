import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import type { AppleHealthRecord } from '@/lib/api'

/**
 * Apple Health export parsing, fully in the browser.
 *
 * export.zip (Health app → profile → Export All Health Data) contains
 * apple_health_export/export.xml — typically 1-10 GB uncompressed, so we
 * stream: the zip is inflated chunk-by-chunk and the text is scanned
 * incrementally for self-closing <Record .../> tags of the five types we
 * import. The whole file is never held in memory at once.
 */

const WANTED_TYPES = new Set([
  'HKQuantityTypeIdentifierBloodPressureSystolic',
  'HKQuantityTypeIdentifierBloodPressureDiastolic',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierBodyTemperature',
])

const UNIT_NORMALISE: Record<string, string> = {
  'count/min': 'bpm',
  degC: '°C',
  degF: '°F',
}

export type ProgressFn = (status: string) => void

/** Simple async channel: producer pushes byte chunks, consumer iterates. */
function byteChannel() {
  const queue: (Uint8Array | null)[] = []
  let waiting: (() => void) | null = null
  const notify = () => {
    waiting?.()
    waiting = null
  }
  return {
    push(chunk: Uint8Array) {
      queue.push(chunk)
      notify()
    },
    close() {
      queue.push(null)
      notify()
    },
    async *iterate(): AsyncGenerator<Uint8Array> {
      for (;;) {
        if (queue.length === 0) await new Promise<void>((r) => (waiting = r))
        const item = queue.shift()
        if (item == null) return
        yield item
      }
    },
  }
}

function streamToIterable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  return (async function* () {
    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  })()
}

/** Pull complete `<Record ... />` elements out of the rolling buffer. */
function drainRecords(buffer: string, sink: (rec: AppleHealthRecord) => void): string {
  let rest = buffer
  let start = rest.indexOf('<Record ')
  while (start !== -1) {
    const end = rest.indexOf('/>', start)
    if (end === -1) break // incomplete tag — wait for more data
    const tag = rest.slice(start, end)
    const type = /type="([^"]+)"/.exec(tag)?.[1]
    if (type && WANTED_TYPES.has(type)) {
      const date = /startDate="(\d{4}-\d{2}-\d{2})/.exec(tag)?.[1]
      const rawValue = /value="([^"]+)"/.exec(tag)?.[1]
      const unit = /unit="([^"]+)"/.exec(tag)?.[1] ?? ''
      const value = rawValue != null ? Number(rawValue) : NaN
      if (date && Number.isFinite(value)) {
        sink({ type, date, value, unit: UNIT_NORMALISE[unit] ?? unit })
      }
    }
    rest = rest.slice(end + 2)
    start = rest.indexOf('<Record ')
  }
  return rest
}

/** Scan a chunk source (inflated XML text) for wanted records. */
async function scanChunks(
  source: AsyncIterable<Uint8Array>,
  onRecord: (rec: AppleHealthRecord) => void,
  onProgress: ProgressFn,
): Promise<number> {
  const decoder = new TextDecoder()
  let buffer = ''
  let found = 0
  let bytes = 0
  let lastReport = 0
  for await (const chunk of source) {
    bytes += chunk.byteLength
    buffer += decoder.decode(chunk, { stream: true })
    buffer = drainRecords(buffer, (rec) => {
      found++
      onRecord(rec)
    })
    if (bytes - lastReport > 32 * 1024 * 1024) {
      lastReport = bytes
      onProgress(`Scanning XML… ${(bytes / 1024 / 1024).toFixed(0)} MB read · ${found.toLocaleString()} records`)
    }
  }
  buffer += decoder.decode()
  drainRecords(buffer, onRecord)
  return found
}

/**
 * Parse an Apple Health export (.zip or .xml), streaming `onRecord` for each
 * wanted record. Resolves with the total number of records found.
 */
export async function parseAppleHealthExport(
  file: File,
  onRecord: (rec: AppleHealthRecord) => void,
  onProgress: ProgressFn,
): Promise<number> {
  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'

  if (!isZip) {
    onProgress('Reading export.xml…')
    return scanChunks(streamToIterable(file.stream()), onRecord, onProgress)
  }

  onProgress('Opening export.zip…')
  const channel = byteChannel()
  let entryFound = false
  let entryEnded = false
  let scanDone = false
  let scanTotal = 0
  let scanError: Error | null = null

  const unzip = new Unzip((entry) => {
    if (entry.name.endsWith('apple_health_export/export.xml') || entry.name === 'export.xml') {
      entryFound = true
      onProgress('Inflating export.xml…')
      // fflate's streaming Unzip delivers DECOMPRESSED chunks once the
      // deflate decoder is registered (see unzip.register below)
      entry.ondata = (err, chunk, final) => {
        if (err) {
          scanError = err
          entryEnded = true
          channel.close()
          return
        }
        channel.push(chunk)
        if (final) {
          entryEnded = true
          channel.close()
        }
      }
      entry.start()
    }
  })
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough) // stored (uncompressed) entries

  // consume the inflated XML in the background
  void scanChunks(channel.iterate(), onRecord, onProgress)
    .then((n) => {
      scanTotal = n
      scanDone = true
    })
    .catch((e) => {
      scanError = e instanceof Error ? e : new Error(String(e))
      scanDone = true
    })

  // pump the zip file through the streaming unwrapper
  const reader = file.stream().getReader()
  let mbRead = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    mbRead += value.byteLength
    unzip.push(value, false)
    if (mbRead % (64 * 1024 * 1024) < 8 * 1024 * 1024) {
      onProgress(`Reading zip… ${(mbRead / 1024 / 1024).toFixed(0)} MB`)
    }
  }
  unzip.push(new Uint8Array(0), true)

  if (!entryFound) throw new Error('apple_health_export/export.xml not found in this zip.')
  // wait until the entry is fully inflated and the scan has consumed the queue
  while (!entryEnded || !scanDone) {
    await new Promise((r) => setTimeout(r, 100))
  }
  if (scanError) throw scanError
  return scanTotal
}

export const APPLE_HEALTH_ACCEPT = '.zip,.xml,application/zip,text/xml'

export const APPLE_HEALTH_TOOLTIP =
  'Import an iPhone Health export (Health app → profile → Export All Health Data → export.zip). ' +
  'Reads blood pressure, heart rate, weight and body temperature. ' +
  'Pushing data TO Apple Health is not possible from a web app (needs a native iOS app with HealthKit).'
