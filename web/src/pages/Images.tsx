import { useState } from 'react'
import { api } from '../api'
import { Button, Card, ErrorNote } from '../components/ui'
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
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Unused images</h1>
        <p className="mt-1 text-ink-soft">
          Images Dockyard pulled for earlier deployments that no container uses any more. Removing them frees disk space;
          if you roll back to one later, Dockyard pulls it again. Images from anything else on this machine are never listed.
        </p>
      </div>

      <div className="space-y-4">
        <ErrorNote error={error} />
        <ErrorNote error={pruneError} />
        {result && <p role="status" className="font-medium text-starboard">{result}</p>}

        {images && count === 0 && (
          <div className="rounded-lg border border-dashed border-rule bg-panel px-6 py-12 text-center">
            <p className="text-lg font-semibold">Nothing to clean up</p>
            <p className="mt-1.5 text-ink-soft">Every image Dockyard pulled is in use.</p>
          </div>
        )}

        {images && count > 0 && (
          <Card className="overflow-hidden">
            <div className="flex justify-between gap-4 border-b border-rule bg-paper/70 px-5 py-2.5 text-xs font-medium tracking-wide text-ink-soft uppercase">
              <span>Image</span>
              <span>Size</span>
            </div>
            <ul className="divide-y divide-rule">
              {images.map((image) => (
                <li key={image.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <span className="truncate font-mono text-[13px]">{shortImage(image.name)}</span>
                  <span className="shrink-0 text-ink-soft tabular-nums">{formatBytes(image.size)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-paper/70 px-5 py-3">
              <span className="text-ink-soft">
                {count} image{count === 1 ? '' : 's'}, up to <span className="font-medium text-ink">{formatBytes(data.totalBytes)}</span>
              </span>
              {confirming ? (
                <span className="flex items-center gap-2">
                  <span className="font-medium">Remove {count === 1 ? 'this image' : `all ${count}`}?</span>
                  <Button variant="danger" size="sm" busy={busy} onClick={prune}>Remove</Button>
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
                </span>
              ) : (
                <Button onClick={() => setConfirming(true)}>Remove unused images</Button>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
