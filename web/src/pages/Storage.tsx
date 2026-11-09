import { useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'
import { api, type UnusedVolume } from '../api'
import { Button, Card, ErrorNote, MetricCard, TextInput } from '../components/ui'
import { IconCheck, IconDatabase, IconImages } from '../components/Icons'
import { cx, formatBytes, useResource } from '../lib'
import ImagesPanel from './Images'

const tabs = [
  { key: '', label: 'Images' },
  { key: 'volumes', label: 'Volumes' },
]

/**
 * One unused volume. Deleting asks for its name to be typed, since a volume cannot be pulled
 * again like an image; downloading a copy first is offered right there.
 */
function VolumeRow({ volume, onDeleted }: { volume: UnusedVolume; onDeleted: (v: UnusedVolume) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api.deleteVolume(volume.name)
      onDeleted(volume)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-mono text-xs font-medium text-ink" title={volume.name}>{volume.name}</p>
          <p className="text-xs text-ink-soft">
            {volume.appName ? (
              <Link to={`/apps/${volume.appId}/settings`} className="font-medium text-ink hover:text-accent hover:underline">{volume.appName}</Link>
            ) : (
              <span className="font-medium text-ink">Deleted app</span>
            )}
            {' · '}
            {volume.reason}
          </p>
          {volume.createdAt && <p className="text-[11px] text-ink-soft">Created {new Date(volume.createdAt).toLocaleDateString()}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-ink-soft">{formatBytes(volume.size)}</span>
          <a
            href={api.volumeArchiveUrl(volume.name)}
            download
            className="inline-flex h-8 items-center rounded-md border border-rule bg-panel px-3 text-xs font-medium text-ink shadow-xs hover:bg-paper"
          >
            Download
          </a>
          {!confirming && (
            <Button size="sm" variant="quiet" className="text-xs text-port hover:bg-port/10" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>
      {volume.warning && (
        <p role="alert" className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-ink">{volume.warning}</p>
      )}
      {confirming && (
        <form
          className="space-y-2 rounded-md border border-port/30 bg-port/5 px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (typed === volume.name) void remove()
          }}
        >
          <p className="text-xs text-ink">
            This deletes {formatBytes(volume.size)} of data for good; it cannot be undone. Type{' '}
            <span className="select-all font-mono font-semibold">{volume.name}</span> to confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              aria-label="Volume name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              className="w-80 max-w-full font-mono text-xs"
            />
            <Button type="submit" size="sm" variant="danger" className="text-xs" busy={busy} disabled={typed !== volume.name}>
              Delete volume
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              className="text-xs"
              onClick={() => {
                setConfirming(false)
                setTyped('')
              }}
            >
              Cancel
            </Button>
          </div>
          <ErrorNote error={error} />
        </form>
      )}
    </li>
  )
}

function VolumesPanel() {
  const { data, error, reload } = useResource(api.unusedVolumes, [])
  const [result, setResult] = useState('')
  const volumes = data?.volumes
  const count = volumes?.length ?? 0

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-soft">
        Docker volumes Dockyard made for apps that no container uses and no app's compose file declares any more: data left behind by a
        removed add-on, a move to the shared Postgres server, or a deleted app. Unlike images, a deleted volume cannot be brought back, so
        download a copy if in doubt. Volumes that belong to anything else on this machine are never listed.
      </p>

      <ErrorNote error={error} />
      {result && (
        <div className="flex items-center gap-3 rounded-lg border border-starboard/30 bg-starboard/5 p-4">
          <IconCheck className="size-5 shrink-0 text-starboard" />
          <p role="status" className="text-sm font-medium text-starboard">{result}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard title="Reclaimable" value={data ? formatBytes(data.totalBytes) : '—'} subtext="Space the unused volumes take" icon={<IconDatabase className="size-5" />} />
        <MetricCard title="Unused Volumes" value={data ? count : '—'} subtext={count === 0 ? 'Nothing left behind' : 'Review each one before deleting'} icon={<IconDatabase className="size-5" />} />
      </div>

      {!data && !error && (
        <div role="status" className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-rule bg-paper/50 px-4 py-5 text-xs text-ink-soft">
          <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Measuring volumes…
        </div>
      )}

      {volumes && count === 0 && (
        <div className="rounded-xl border border-dashed border-rule bg-panel px-6 py-14 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-starboard/10 text-starboard">
            <IconCheck className="size-5" />
          </div>
          <p className="text-base font-semibold text-ink">No unused volumes</p>
          <p className="mt-1 text-xs text-ink-soft">Every volume Dockyard made is still in use by its app.</p>
        </div>
      )}

      {volumes && count > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-rule bg-paper/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            <span>Volume</span>
            <span>Size</span>
          </div>
          <ul className="divide-y divide-rule">
            {volumes.map((v) => (
              <VolumeRow
                key={v.name}
                volume={v}
                onDeleted={(gone) => {
                  setResult(`Deleted ${gone.name} and freed ${formatBytes(gone.size)}.`)
                  void reload()
                }}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default function StoragePage() {
  const { tab = '' } = useParams()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
          <IconImages className="size-5 text-ink-soft" />
          Storage Cleanup
        </h1>
        <p className="mt-1 text-sm text-ink-soft">Reclaim disk space from images and volumes that nothing on this machine uses any more.</p>
      </div>
      <div className="border-b border-rule">
        <nav className="-mb-px flex gap-1" aria-label="Storage sections">
          {tabs.map((t) => (
            <NavLink
              key={t.key}
              to={`/storage${t.key ? `/${t.key}` : ''}`}
              end
              className={({ isActive }) =>
                cx(
                  'border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-soft hover:border-rule hover:text-ink',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      {tab === 'volumes' ? <VolumesPanel /> : <ImagesPanel />}
    </div>
  )
}
