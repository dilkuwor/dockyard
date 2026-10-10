import { useState } from 'react'
import { api, type AppDetail } from '../api'
import { Button, ErrorNote } from './ui'
import { formatBytes, timeAgo, useResource } from '../lib'

/** App settings: put this app's data back from one of the backups that hold it. */
export default function RestoreBackup({ app, onChange }: { app: AppDetail; onChange: () => void }) {
  const { data: list, error } = useResource(() => api.appBackups(app.id), [app.id])
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [log, setLog] = useState<string | null>(null)

  async function restore(backupId: string) {
    setBusy(backupId)
    setActionError(null)
    setLog(null)
    try {
      const result = await api.restoreBackup(backupId, app.id)
      setLog(result.log)
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
        Replaces this app's data volumes, and its Postgres database if it has the add-on, with the contents of a backup. Settings and the image
        stay as they are. The app is stopped for the restore and started again, and the data it had is archived next to the backup first.
      </p>
      {!list || list.length === 0 ? (
        <p className="text-sm text-ink-soft">No backups of this app yet. Backups run from the Settings page.</p>
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule">
          {list.map((b) => (
            <li key={b.backupId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 text-xs">
                <span className="font-mono text-ink">{b.backupId}</span>
                <span className="text-ink-soft">{timeAgo(b.startedAt)}</span>
                <span className="text-ink-soft">{formatBytes(b.size)}</span>
                <span className="text-ink-soft">{b.detail}</span>
              </div>
              {confirming === b.backupId ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-soft">Replace the current data?</span>
                  <Button size="sm" variant="danger" className="text-xs" busy={busy === b.backupId} onClick={() => restore(b.backupId)}>
                    Restore
                  </Button>
                  <Button size="sm" variant="quiet" className="text-xs" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" className="text-xs" disabled={busy !== null} onClick={() => setConfirming(b.backupId)}>
                  Restore from this
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={actionError} />
      {log && (
        <pre className="max-h-48 overflow-auto rounded-md scheme-dark bg-console px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-console-text">
          {log}
        </pre>
      )}
    </div>
  )
}
