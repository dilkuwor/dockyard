import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type AddonType, type AppDetail, type PostgresMigration } from '../api'
import { Button, ErrorNote } from './ui'
import { IconCheck, IconDatabase } from './Icons'
import { useResource } from '../lib'

/**
 * Moves the app's own Postgres to a database on the shared server, data included. It runs on the
 * server; this follows its log until it finishes.
 */
function MoveToShared({ app, onDone }: { app: AppDetail; onDone: () => void }) {
  const [migration, setMigration] = useState<PostgresMigration | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    api.postgresMigration(app.id).then((r) => setMigration(r.migration), () => undefined)
  }, [app.id])

  const running = migration?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => {
      try {
        const { migration: next } = await api.postgresMigration(app.id)
        setMigration(next)
        if (next && next.status !== 'running') onDone()
      } catch {
        // Try again on the next tick.
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [running, app.id, onDone])

  async function start() {
    setError(null)
    setConfirming(false)
    try {
      setMigration(await api.migratePostgres(app.id))
    } catch (err) {
      setError(err)
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {!running &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <span>The app stops while its data is copied, then redeploys on the shared server. The old volume is kept.</span>
            <Button size="sm" variant="accent" className="text-xs" onClick={start}>
              Move now
            </Button>
            <Button size="sm" variant="quiet" className="text-xs" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" className="text-xs" onClick={() => setConfirming(true)}>
            Move to shared server
          </Button>
        ))}
      <ErrorNote error={error} />
      {migration && (
        <pre className="max-h-56 overflow-auto rounded-md border border-rule bg-ink p-2.5 font-mono text-[11px] leading-relaxed text-paper">
          {migration.log.join('\n') || 'Starting…'}
        </pre>
      )}
    </div>
  )
}

/** Managed services added to an app's compose file, with their connection details in its environment. */
export default function Addons({ app, onChange }: { app: AppDetail; onChange: () => void }) {
  const { data: list, error, reload } = useResource(() => api.addons(app.id), [app.id])
  const [busy, setBusy] = useState<AddonType | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<AddonType | null>(null)

  async function act(type: AddonType, fn: () => Promise<{ note: string }>) {
    setBusy(type)
    setActionError(null)
    setNotice(null)
    try {
      const result = await fn()
      setNotice(result.note)
      await reload()
      onChange()
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  if (error && !list) return <ErrorNote error={error} />

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft">
        An add-on is a service in this app's compose file with its own named volume, or a database on the Postgres server Dockyard
        runs for all apps. Either way its connection details are put into the app's environment. Changes apply on the next deploy.
        The shared server itself is managed on{' '}
        <Link to="/services" className="font-medium text-accent hover:underline">Shared Services</Link>.
      </p>
      <ul className="divide-y divide-rule rounded-lg border border-rule">
        {(list ?? []).map((a) => (
          <li key={a.type} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-violet/12 text-violet">
                <IconDatabase className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {a.label}
                  {a.added && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-starboard/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-starboard uppercase">
                      <IconCheck className="size-3" />
                      Added
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">{a.note}</p>
                <p className="mt-1 font-mono text-[11px] text-ink-soft">
                  {a.kind === 'shared' && a.added ? `${a.service} · ` : ''}
                  {a.envKeys.join(' · ')}
                </p>
                {a.type === 'postgres' && a.added && !app.previewOf && <MoveToShared app={app} onDone={() => { void reload(); onChange() }} />}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {a.added ? (
                confirming === a.type ? (
                  <>
                    <span className="text-xs text-ink-soft">
                      {a.kind === 'shared' ? 'Remove it? The database and everything in it are deleted.' : 'Remove it? Its data volume is kept.'}
                    </span>
                    <Button size="sm" variant="danger" className="text-xs" busy={busy === a.type} onClick={() => act(a.type, () => api.removeAddon(app.id, a.type))}>
                      Remove
                    </Button>
                    <Button size="sm" variant="quiet" className="text-xs" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="quiet" className="text-xs text-port hover:bg-port/10" onClick={() => setConfirming(a.type)}>
                    Remove
                  </Button>
                )
              ) : (
                <Button size="sm" className="text-xs" busy={busy === a.type} onClick={() => act(a.type, () => api.addAddon(app.id, a.type))}>
                  Add {a.label.split(' ')[0]}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ErrorNote error={actionError} />
      {notice && (
        <p role="status" className="text-xs font-medium text-starboard">
          {notice}
        </p>
      )}
    </div>
  )
}
