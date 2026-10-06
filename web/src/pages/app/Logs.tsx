import { useEffect, useRef, useState } from 'react'
import type { AppDetail } from '../../api'
import { Button } from '../../components/ui'
import { cx } from '../../lib'

const MAX_LINES = 3000

export default function Logs({ app }: { app: AppDetail }) {
  const [lines, setLines] = useState<string[]>([])
  const [follow, setFollow] = useState(true)
  const [connected, setConnected] = useState(false)
  const [session, setSession] = useState(0)
  const paneRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    setLines([])
    const source = new EventSource(`/api/apps/${app.id}/logs/stream?tail=300`)
    source.onopen = () => setConnected(true)
    source.onmessage = (e) => {
      const line = JSON.parse(e.data) as string
      setLines((prev) => (prev.length >= MAX_LINES ? [...prev.slice(-MAX_LINES + 1), line] : [...prev, line]))
    }
    const stop = () => {
      setConnected(false)
      source.close()
    }
    source.addEventListener('end', stop)
    source.onerror = stop
    return () => source.close()
  }, [app.id, session])

  useEffect(() => {
    if (follow && paneRef.current) paneRef.current.scrollTop = paneRef.current.scrollHeight
  }, [lines, follow])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cx('inline-flex items-center gap-2 font-medium', connected ? 'text-starboard' : 'text-ink-soft')}>
          <span aria-hidden className={cx('size-1.5 rounded-full', connected ? 'animate-pulse bg-starboard' : 'bg-ink-soft/60')} />
          {connected ? 'Streaming live' : 'Stream closed'}
        </span>
        {!connected && <Button size="sm" onClick={() => setSession((s) => s + 1)}>Reconnect</Button>}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="size-4 accent-ink" />
          Follow new lines
        </label>
        <Button variant="quiet" size="sm" onClick={() => setLines([])}>Clear</Button>
      </div>
      <pre
        ref={paneRef}
        className="h-[60vh] overflow-auto rounded-lg scheme-dark bg-console px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-console-text"
      >
        {lines.length ? lines.join('\n') : 'No log output yet.'}
      </pre>
    </div>
  )
}
