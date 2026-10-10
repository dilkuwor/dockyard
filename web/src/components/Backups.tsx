import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type BackupDetail } from '../api'
import { Button, ErrorNote, Field, TextInput } from './ui'
import { IconCheck } from './Icons'
import { formatBytes, timeAgo, useResource } from '../lib'

const statusTone: Record<string, string> = {
  running: 'text-accent',
  succeeded: 'text-starboard',
  failed: 'text-port',
}

/** Settings card: schedule, retention, "Back up now" and the run history. */
export default function Backups() {
  const { data, error, reload, setData } = useResource(api.backups, [], 5000)
  const [time, setTime] = useState<string | null>(null)
  const [retention, setRetention] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  if (!data) return <ErrorNote error={error} />
  const settings = data.settings
  const timeValue = time ?? settings.time
  const retentionValue = retention ?? String(settings.retention)
  const dirty = time !== null || retention !== null

  async function saveSettings(patch: { enabled?: boolean }) {
    setBusy('save')
    setActionError(null)
    setSaved(false)
    try {
      const next = await api.saveBackupSettings({ time: timeValue, retention: Number(retentionValue), ...patch })
      setData({ ...data!, settings: next })
      setTime(null)
      setRetention(null)
      setSaved(true)
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(null)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void saveSettings({})
  }

  async function runNow() {
    setBusy('run')
    setActionError(null)
    try {
      const { id } = await api.runBackup()
      setOpenId(id)
      await reload()
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    setBusy(id)
    setActionError(null)
    try {
      await api.deleteBackup(id)
      if (openId === id) setOpenId(null)
      await reload()
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      {!data.ready && (
        <p className="rounded-md border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
          The backup directory is not mounted. Pull the latest <span className="font-mono text-xs">docker-compose.yml</span>, run{' '}
          <span className="font-mono text-xs">docker compose up -d</span> once by hand, and backups can start.
        </p>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={!data.ready || busy === 'save'}
              onChange={(e) => saveSettings({ enabled: e.target.checked })}
              className="size-4 accent-ink"
            />
            <span className="font-medium text-ink">Back up every day</span>
          </label>
          <Field label="At (server time)">
            <TextInput type="time" value={timeValue} onChange={(e) => setTime(e.target.value)} className="w-32" />
          </Field>
          <Field label="Keep">
            <div className="flex items-center gap-2">
              <TextInput type="number" min={1} max={365} value={retentionValue} onChange={(e) => setRetention(e.target.value)} className="w-20" />
              <span className="text-sm text-ink-soft">backups</span>
            </div>
          </Field>
          <Button type="submit" size="sm" busy={busy === 'save'} disabled={!dirty}>
            Save schedule
          </Button>
          {saved && !dirty && (
            <span role="status" className="inline-flex h-9 items-center gap-1 text-xs font-semibold text-starboard">
              <IconCheck className="size-3.5" />
              Saved
            </span>
          )}
        </div>
        <p className="text-xs text-ink-soft">
          Each run archives Dockyard's own settings and every app's data volumes into <span className="font-mono">{data.directory}</span> on
          this machine, with a consistent dump for the Postgres add-on. Apps are paused for the few seconds their files are copied. Copy that
          directory somewhere off the machine for a real safety net.
        </p>
        {data.excluded.length > 0 && (
          <p className="text-xs text-ink-soft">
            Not backed up, by their own setting:{' '}
            {data.excluded.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ', '}
                <Link to={`/apps/${a.id}/settings`} className="font-medium text-ink hover:text-accent">
                  {a.name}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
        <h3 className="text-sm font-semibold text-ink">Backups</h3>
        <Button size="sm" variant="primary" className="text-xs" busy={busy === 'run' || data.running} disabled={!data.ready} onClick={runNow}>
          {data.running ? 'Backing up…' : 'Back up now'}
        </Button>
      </div>

      <ErrorNote error={actionError} />

      {data.backups.length === 0 ? (
        <p className="text-sm text-ink-soft">No backups yet.</p>
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule">
          {data.backups.map((b) => (
            <li key={b.id}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 text-sm">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === b.id ? null : b.id)}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 text-left"
                >
                  <span className={`w-20 text-xs font-semibold capitalize ${statusTone[b.status] ?? ''}`}>{b.status}</span>
                  <span className="font-mono text-xs text-ink">{b.id}</span>
                  <span className="text-xs text-ink-soft">{b.kind}</span>
                  <span className="text-xs text-ink-soft">{timeAgo(b.startedAt)}</span>
                  <span className="text-xs text-ink-soft">{formatBytes(b.size)}</span>
                </button>
                {b.status !== 'running' && (
                  <Button size="sm" variant="quiet" className="text-xs text-port hover:bg-port/10" busy={busy === b.id} onClick={() => remove(b.id)}>
                    Delete
                  </Button>
                )}
              </div>
              {openId === b.id && <BackupDetails id={b.id} live={b.status === 'running'} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BackupDetails({ id, live }: { id: string; live: boolean }) {
  const { data } = useResource(() => api.backup(id), [id, live], live ? 2000 : false)
  if (!data) return null
  const d: BackupDetail = data
  return (
    <div className="space-y-2 border-t border-rule/70 bg-paper/50 px-4 py-3 text-xs">
      {d.items.length > 0 && (
        <ul className="space-y-0.5">
          {d.items.map((i) => (
            <li key={i.appId} className="flex flex-wrap gap-x-3">
              <span className="w-40 truncate font-medium text-ink">{i.appName}</span>
              <span className={i.status === 'failed' ? 'text-port' : i.status === 'empty' ? 'text-ink-soft' : 'text-starboard'}>{i.status}</span>
              <span className="text-ink-soft">{i.size ? formatBytes(i.size) : ''}</span>
              <span className="text-ink-soft">{i.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <pre className="max-h-48 overflow-auto rounded-md scheme-dark bg-console px-3 py-2 font-mono leading-relaxed whitespace-pre-wrap text-console-text">
        {d.log || 'Starting…'}
      </pre>
    </div>
  )
}
