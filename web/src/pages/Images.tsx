import { useState } from 'react'
import { api } from '../api'
import { Button, Card, ErrorNote, MetricCard } from '../components/ui'
import { IconImages, IconCheck } from '../components/Icons'
import { formatBytes, shortImage, useResource } from '../lib'

export default function ImagesPage() {
  const { data, error, reload } = useResource(api.unusedImages, [])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [pruneError, setPruneError] = useState<unknown>(null)

  async function prune() {
    setBusy(true)
    setPruneError(null)
    setResult('')
    try {
      const res = await api.pruneImages()
      const removed = `Removed ${res.removed} image${res.removed === 1 ? '' : 's'} and freed up to ${formatBytes(res.bytes)}.`
      const failed = res.failed ? ` ${res.failed} could not be removed because something started using them.` : ''
      setResult(removed + failed)
      await reload()
    } catch (err) {
      setPruneError(err)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const images = data?.images
  const count = images?.length ?? 0

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Images & Storage Reclamation</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Images Dockyard previously pulled that are no longer used by any container. Removing them frees host disk space.
          If rolled back later, Dockyard will re-pull the required image.
        </p>
      </div>

      <ErrorNote error={error} />
      <ErrorNote error={pruneError} />

      {result && (
        <div className="rounded-lg border border-starboard/30 bg-starboard/5 p-4 flex items-center gap-3">
          <IconCheck className="size-5 text-starboard shrink-0" />
          <p role="status" className="text-sm font-medium text-starboard">{result}</p>
        </div>
      )}

      {/* Storage Summary Metric */}
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          title="Reclaimable Host Space"
          value={data ? formatBytes(data.totalBytes) : '0 B'}
          subtext="Potential disk space freed upon prune"
          icon={<IconImages className="size-5" />}
        />
        <MetricCard
          title="Unused Images"
          value={count}
          subtext={count === 0 ? 'Docker host is clean' : `${count} orphan image layer${count === 1 ? '' : 's'}`}
          icon={<IconImages className="size-5" />}
          action={
            count > 0 && !confirming && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setConfirming(true)}
                className="w-full text-xs"
              >
                Prune all {count} unused images
              </Button>
            )
          }
        />
      </div>

      {images && count === 0 && (
        <div className="rounded-xl border border-dashed border-rule bg-panel px-6 py-14 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-starboard/10 text-starboard">
            <IconCheck className="size-5" />
          </div>
          <p className="text-base font-semibold text-ink">Host storage is optimized</p>
          <p className="mt-1 text-xs text-ink-soft">
            Every image pulled by Dockyard is currently bound to an active container.
          </p>
        </div>
      )}

      {images && count > 0 && (
        <Card className="overflow-hidden">
          <div className="flex justify-between items-center border-b border-rule bg-paper/70 px-5 py-3 text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
            <span>Image Tag & Digest</span>
            <span>Unused Size</span>
          </div>
          <ul className="divide-y divide-rule">
            {images.map((image) => (
              <li key={image.id} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-paper/40 transition-colors">
                <span className="truncate font-mono text-xs text-ink" title={image.name}>
                  {shortImage(image.name)}
                </span>
                <span className="shrink-0 text-xs font-mono text-ink-soft tabular-nums">
                  {formatBytes(image.size)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-paper/50 px-5 py-3.5">
            <span className="text-xs text-ink-soft">
              {count} image{count === 1 ? '' : 's'} · up to <span className="font-semibold text-ink">{formatBytes(data.totalBytes)}</span> reclaimable
            </span>

            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-port">
                  Confirm remove {count === 1 ? 'image' : `all ${count}`}?
                </span>
                <Button variant="danger" size="sm" busy={busy} onClick={prune}>
                  Confirm Prune
                </Button>
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
                Remove unused images
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
