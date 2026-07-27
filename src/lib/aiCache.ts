/**
 * Small two-tier cache for AI text responses: in-memory Map (instant)
 * backed by localStorage (persists across reloads), FIFO-capped.
 */

export interface AiCache {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
}

export function createAiCache(lsKey: string, maxEntries = 50): AiCache {
  const mem = new Map<string, string>()

  function readStore(): Record<string, string> {
    try {
      const raw = localStorage.getItem(lsKey)
      if (!raw) return {}
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  return {
    get(key) {
      const hit = mem.get(key)
      if (hit) return hit
      const stored = readStore()[key]
      if (typeof stored === 'string' && stored.length > 0) {
        mem.set(key, stored)
        return stored
      }
      return null
    },
    set(key, value) {
      mem.set(key, value)
      if (mem.size > maxEntries) {
        const oldest = mem.keys().next().value
        if (oldest !== undefined) mem.delete(oldest)
      }
      try {
        const store = readStore()
        store[key] = value
        const keys = Object.keys(store)
        while (keys.length > maxEntries) delete store[keys.shift() as string]
        localStorage.setItem(lsKey, JSON.stringify(store))
      } catch {
        /* storage full / unavailable — memory cache still works */
      }
    },
  }
}

/** Stable cache key from a marker list + scope. */
export function markersHash(
  scope: string,
  date: string | undefined,
  markers: Array<{ name: string; value: number; flag: string }>,
): string {
  const sig = markers
    .map((m) => `${m.name.toLowerCase()}:${m.value}:${m.flag}`)
    .sort()
    .join(',')
  return `${scope}|${date ?? ''}|${sig}`
}
