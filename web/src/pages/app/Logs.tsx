import { useEffect, useRef, useState } from 'react'
import type { AppDetail } from '../../api'
import { Button } from '../../components/ui'
import { IconSearch, IconCopy, IconCheck, IconRotateCw } from '../../components/Icons'
import { cx } from '../../lib'

const MAX_LINES = 3000

export default function Logs({ app }: { app: AppDetail }) {
  const [lines, setLines] = useState<string[]>([])
  const [filterQuery, setFilterQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const [connected, setConnected] = useState(false)
  const [session, setSession] = useState(0)
  const [copied, setCopied] = useState(false)
  const paneRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let active = true
    const source = new EventSource(`/api/apps/${app.id}/logs/stream?tail=300`)

    source.onopen = () => {
      if (active) setConnected(true)
    }

    source.onmessage = (e) => {
      if (!active) return
      const line = JSON.parse(e.data) as string
      setLines((prev) => (prev.length >= MAX_LINES ? [...prev.slice(-MAX_LINES + 1), line] : [...prev, line]))
    }

    const stop = () => {
      if (active) setConnected(false)
      source.close()
    }

    source.addEventListener('end', stop)
    source.onerror = stop

    return () => {
      active = false
      source.close()
    }
  }, [app.id, session])

  useEffect(() => {
    if (follow && paneRef.current) {
      paneRef.current.scrollTop = paneRef.current.scrollHeight
    }
  }, [lines, follow])

  const filteredLines = filterQuery.trim()
    ? lines.filter((l) => l.toLowerCase().includes(filterQuery.toLowerCase()))
    : lines

  async function copyAll() {
    const text = filteredLines.join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-3">
      {/* Console Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-panel px-4 py-2.5 shadow-xs">
        {/* Stream Status Indicator */}
        <div className="flex items-center gap-3">
          <span className={cx('inline-flex items-center gap-2 text-xs font-semibold', connected ? 'text-starboard' : 'text-ink-soft')}>
            <span aria-hidden className={cx('size-2 rounded-full', connected ? 'animate-pulse bg-starboard' : 'bg-ink-soft/60')} />
            {connected ? 'Live Log Stream' : 'Stream Disconnected'}
          </span>

          {!connected && (
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5 text-xs h-7 px-2"
              onClick={() => {
                setLines([])
                setSession((s) => s + 1)
              }}
            >
              <IconRotateCw className="size-3" />
              <span>Reconnect</span>
            </Button>
          )}

          <span className="text-xs text-ink-soft hidden sm:inline">
            {filteredLines.length} line{filteredLines.length === 1 ? '' : 's'}
            {filterQuery && ` (filtered from ${lines.length})`}
          </span>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2.5 ml-auto">
          {/* Quick Filter Input */}
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-ink-soft/70" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter logs…"
              className="h-7.5 w-36 sm:w-48 rounded border border-rule bg-paper pl-8 pr-2 text-xs text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer select-none">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="size-3.5 accent-ink rounded"
            />
            <span>Follow</span>
          </label>

          <Button
            size="sm"
            variant="secondary"
            className="gap-1 text-xs h-7.5 px-2.5"
            onClick={copyAll}
            disabled={filteredLines.length === 0}
            title="Copy logs to clipboard"
          >
            {copied ? <IconCheck className="size-3 text-starboard" /> : <IconCopy className="size-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </Button>

          <Button
            variant="quiet"
            size="sm"
            className="text-xs h-7.5 px-2"
            onClick={() => setLines([])}
            title="Clear console buffer"
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div className="relative rounded-xl overflow-hidden border border-slate-800 shadow-md">
        <div className="flex items-center justify-between bg-slate-900 border-b border-slate-800 px-4 py-2 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-red-500/80 inline-block" />
            <span className="size-2.5 rounded-full bg-yellow-500/80 inline-block" />
            <span className="size-2.5 rounded-full bg-green-500/80 inline-block" />
            <span className="ml-2">{app.name} / container stdout & stderr</span>
          </div>
          <span>tail=300</span>
        </div>
        <pre
          ref={paneRef}
          className="h-[calc(100dvh-19.5rem)] min-h-64 overflow-auto scheme-dark bg-console p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-console-text select-text"
        >
          {filteredLines.length ? (
            filteredLines.join('\n')
          ) : filterQuery ? (
            <span className="text-slate-500 italic">No log lines matching "{filterQuery}".</span>
          ) : (
            <span className="text-slate-500 italic">Waiting for container log output…</span>
          )}
        </pre>
      </div>
    </div>
  )
}
