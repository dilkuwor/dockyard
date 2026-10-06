import { useCallback, useEffect, useRef, useState } from 'react'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString()
}

export function duration(start: number, end: number | null): string {
  if (!end) return ''
  const s = Math.max(0, Math.round((end - start) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Shortens "user/app@sha256:abcdef…" to "user/app@abcdef1". */
export function shortImage(image: string | null): string {
  if (!image) return '—'
  const at = image.indexOf('@sha256:')
  return at === -1 ? image : `${image.slice(0, at)}@${image.slice(at + 8, at + 15)}`
}

export function useResource<T>(load: () => Promise<T>, deps: unknown[], pollMs?: number | false) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current())
      setError(null)
    } catch (err) {
      setError(err as Error)
    }
  }, [])

  useEffect(() => {
    setData(null)
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    if (!pollMs) return
    const t = setInterval(reload, pollMs)
    return () => clearInterval(t)
  }, [pollMs, reload])

  return { data, error, reload, setData }
}
