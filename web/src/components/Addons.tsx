import { useState } from 'react'
import { api, type AddonType, type AppDetail } from '../api'
import { Button, ErrorNote } from './ui'
import { IconCheck, IconDatabase } from './Icons'
import { useResource } from '../lib'

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
        Each add-on becomes a service in this app's compose file with its own named volume, and its connection details are put
        into the app's environment. Changes apply on the next deploy.
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
                <p className="mt-1 font-mono text-[11px] text-ink-soft">{a.envKeys.join(' · ')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {a.added ? (
                confirming === a.type ? (
                  <>
                    <span className="text-xs text-ink-soft">Remove it? Its data volume is kept.</span>
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
