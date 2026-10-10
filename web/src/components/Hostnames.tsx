import { useState, type FormEvent } from 'react'
import { api, type AppDetail, type HostnameInfo, type SetupStep } from '../api'
import { Button, ErrorNote, TextInput } from './ui'
import { IconExternalLink, IconPlus } from './Icons'
import { SetupSteps } from './PublicAccess'
import { useResource } from '../lib'

/** Extra hostnames an app answers on, such as www.example.com, besides its <slug>.<domain> address. */
export default function Hostnames({ app, onChange }: { app: AppDetail; onChange: () => void }) {
  const { data: list, error, setData } = useResource(() => api.hostnames(app.id), [app.id])
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [steps, setSteps] = useState<SetupStep[]>([])

  async function run(key: string, fn: () => Promise<{ ok: boolean; steps: SetupStep[]; hostnames: HostnameInfo[] }>) {
    setBusy(key)
    setActionError(null)
    setSteps([])
    try {
      const result = await fn()
      setSteps(result.steps)
      setData(result.hostnames)
      if (result.ok && key === 'add') setValue('')
      onChange()
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(null)
    }
  }

  function add(e: FormEvent) {
    e.preventDefault()
    void run('add', () => api.addHostname(app.id, value))
  }

  if (error && !list) return <ErrorNote error={error} />

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft">
        Point a domain of your own at this app, such as <span className="font-mono">www.example.com</span> or{' '}
        <span className="font-mono">example.com</span>. The domain must be in the same Cloudflare account; Dockyard adds the tunnel
        route and DNS record, and the hostname starts working within a minute. The app's own address keeps working too.
      </p>

      {list && list.length > 0 && (
        <ul className="divide-y divide-rule rounded-lg border border-rule">
          {list.map((h) => (
            <li key={h.hostname} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <a
                href={`https://${h.hostname}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[13px] text-ink hover:text-accent hover:underline"
              >
                {h.hostname}
                <IconExternalLink className="size-3 opacity-60" />
              </a>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-soft">{h.cloudflare ? 'DNS and route by Dockyard' : 'Covered by a domain wildcard'}</span>
                <Button
                  size="sm"
                  variant="quiet"
                  className="text-xs text-port hover:bg-port/10"
                  busy={busy === h.hostname}
                  onClick={() => run(h.hostname, () => api.removeHostname(app.id, h.hostname))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <TextInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="www.example.com"
          className="w-72 font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <Button type="submit" size="sm" className="gap-1.5 text-xs" busy={busy === 'add'}>
          <IconPlus className="size-3.5" />
          Add hostname
        </Button>
      </form>

      <ErrorNote error={actionError} />
      <SetupSteps steps={steps} />
    </div>
  )
}
