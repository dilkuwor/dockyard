import { useEffect, useRef, useState } from 'react'
import type { AppDetail } from '../../api'
import { Button } from '../../components/ui'

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
        <span className={connected ? 'font-semibold text-starboard' : 'font-semibold text-ink-soft'}>
          {connected ? 'Streaming live' : 'Stream closed'}
        </span>
        {!connected && <Button className="px-2.5 py-1 text-sm" onClick={() => setSession((s) => s + 1)}>Reconnect</Button>}
        <label className="ml-auto flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="size-4 accent-ink" />
          Follow new lines
        </label>
        <Button variant="quiet" className="px-2.5 py-1 text-sm" onClick={() => setLines([])}>Clear</Button>
      </div>
      <pre
        ref={paneRef}
        className="h-[60vh] overflow-auto bg-console px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-console-text"
      >
        {lines.length ? lines.join('\n') : 'No log output yet.'}
      </pre>
    </div>
  )
}
