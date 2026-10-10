import { useEffect, useState } from 'react'
import { api } from '../api'
import { Button, ErrorNote } from './ui'
import { IconCheck, IconRotateCw } from './Icons'
import { timeAgo, useResource } from '../lib'

const short = (value: string | null) => (value ? value.replace(/^sha256:/, '').slice(0, 12) : '—')

/** Settings card: which published image runs, whether the registry has a newer one, and a button to update in place. */
export default function SoftwareUpdate() {
  const { data: status, error, reload, setData } = useResource(api.updateStatus, [])
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [log, setLog] = useState<string>('')
  const updating = status?.updater.state === 'running' || busy === 'apply'

  // While the helper runs, follow its log; when the new server is up again, the status call succeeds.
  useEffect(() => {
    if (!updating) return
    const timer = setInterval(async () => {
      setLog(await api.updateLog().catch(() => ''))
      api
        .updateStatus()
        .then((s) => {
          setData(s)
          if (s.updater.state !== 'running') setBusy(null)
        })
        .catch(() => undefined)
    }, 3000)
    return () => clearInterval(timer)
  }, [updating, setData])

  async function check() {
    setBusy('check')
    setActionError(null)
    try {
      setData(await api.updateStatus(true))
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(null)
    }
  }

  async function apply() {
    setBusy('apply')
    setActionError(null)
    setLog('')
    try {
      await api.applyUpdate()
    } catch (err) {
      setActionError(err)
      setBusy(null)
    }
  }

  if (!status) return <ErrorNote error={error} />
  const canApply = status.latest.digest !== null && (status.updateAvailable === true || status.running.local)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          {status.updater.state === 'running' ? (
            <p className="font-semibold text-accent">Updating… this page will reconnect when the new version is up.</p>
          ) : status.updateAvailable === null ? (
            <p className="text-ink-soft">{status.blocked ?? 'Could not check for updates.'}</p>
          ) : status.updateAvailable ? (
            <p className="font-semibold text-ink">
              A newer image is published
              {status.commits.length > 0 && (
                <>
                  {' '}
                  with {status.commits.length} new commit{status.commits.length === 1 ? '' : 's'}
                </>
              )}
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 font-semibold text-starboard">
              <IconCheck className="size-4" />
              Up to date
            </p>
          )}
          <p className="mt-1 text-xs text-ink-soft">
            <span className="font-mono">{status.image ?? '—'}</span>
            {status.running.local ? ' · built on this machine' : <> · running <span className="font-mono">{short(status.running.digest)}</span></>}
            {status.running.revision && <> · commit <span className="font-mono">{status.running.revision.slice(0, 7)}</span></>}
            {status.latest.digest && <> · published <span className="font-mono">{short(status.latest.digest)}</span></>}
            {status.checkedAt && <> · checked {timeAgo(status.checkedAt)}</>}
            {status.updater.state === 'done' && status.updater.startedAt && <> · last update {timeAgo(status.updater.startedAt)}</>}
            {status.updater.state === 'failed' && <span className="text-port"> · the last update failed; see the log below</span>}
          </p>
          {status.blocked && status.updateAvailable !== null && <p className="mt-1 text-xs text-warn">{status.blocked}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-1.5 text-xs" busy={busy === 'check'} disabled={updating} onClick={check}>
            <IconRotateCw className="size-3.5" />
            Check now
          </Button>
          {canApply && (
            <Button size="sm" variant="primary" className="text-xs" busy={updating} onClick={apply}>
              Update now
            </Button>
          )}
        </div>
      </div>

      {status.commits.length > 0 && !updating && (
        <ul className="divide-y divide-rule rounded-lg border border-rule text-xs">
          {status.commits.slice(0, 10).map((c) => (
            <li key={c.sha} className="flex items-start gap-3 px-3 py-2">
              <span className="shrink-0 font-mono text-ink-soft">{c.sha.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{c.message}</span>
              <span className="shrink-0 text-ink-soft">{c.author}</span>
            </li>
          ))}
          {status.commits.length > 10 && <li className="px-3 py-2 text-ink-soft">and {status.commits.length - 10} more</li>}
        </ul>
      )}

      <ErrorNote error={actionError} />

      {(updating || status.updater.state === 'failed') && (
        <pre className="max-h-64 overflow-auto rounded-md scheme-dark bg-console px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-console-text">
          {log || 'Starting the updater…'}
        </pre>
      )}

      <p className="text-[11px] text-ink-soft">
        An update pulls the published image and recreates only the dockyard service from it, then removes the old image. Apps keep running
        throughout; the dashboard is unavailable for about a minute. The manual equivalent is{' '}
        <span className="font-mono">docker compose pull dockyard && docker compose up -d dockyard</span>.
      </p>
      {status.updater.state === 'failed' && (
        <Button size="sm" variant="quiet" className="text-xs" onClick={() => reload()}>
          Dismiss
        </Button>
      )}
    </div>
  )
}
