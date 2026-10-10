import { useState, type FormEvent } from 'react'
import { api, type PublicAccessStatus, type SetupResult } from '../api'
import { Button, ErrorNote, Field, Select, TextInput } from './ui'
import { IconPlus } from './Icons'

/**
 * The public domains apps can live under. The first is the dashboard's and cannot be removed;
 * the others ride the same tunnel. Adding one in automatic mode uses the API token saved at
 * setup; without a saved token it asks for one.
 */
export default function Domains({
  status,
  onResult,
}: {
  status: PublicAccessStatus
  onResult: (result: SetupResult | PublicAccessStatus) => void
}) {
  const [adding, setAdding] = useState(false)
  const [apiToken, setApiToken] = useState('')
  const [zones, setZones] = useState<{ id: string; name: string }[] | null>(null)
  const [zoneId, setZoneId] = useState('')
  const [domain, setDomain] = useState('')
  const [replaceDns, setReplaceDns] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeToken, setRemoveToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  const automatic = status.mode === 'automatic'
  const saved = status.hasApiToken
  const taken = new Set(status.domains.map((d) => d.domain))
  const available = (zones ?? []).filter((z) => !taken.has(z.name))

  async function run(key: string, fn: () => Promise<SetupResult | PublicAccessStatus>, after?: () => void) {
    setBusy(key)
    setError(null)
    try {
      const result = await fn()
      onResult(result)
      if (!('ok' in result) || result.ok) after?.()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  async function loadZones(token: string) {
    setBusy('check')
    setError(null)
    try {
      const list = await api.cloudflareZones(token)
      setZones(list)
      const first = list.find((z) => !taken.has(z.name))
      setZoneId(first?.id ?? '')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  function checkToken(e: FormEvent) {
    e.preventDefault()
    void loadZones(apiToken)
  }

  /** With a saved token the zone list loads at once; otherwise the form asks for a token first. */
  function startAdd() {
    setAdding(true)
    if (automatic && saved) void loadZones('')
  }

  function resetAdd() {
    setAdding(false)
    setApiToken('')
    setZones(null)
    setZoneId('')
    setDomain('')
    setReplaceDns(false)
  }

  return (
    <div className="space-y-3 border-t border-rule pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Domains</h3>
          <p className="text-xs text-ink-soft">
            Apps can live under any of these. New apps go to the default one unless a domain is chosen.
          </p>
        </div>
        {!adding && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={startAdd}>
            <IconPlus className="size-3.5" />
            Add domain
          </Button>
        )}
      </div>

      <ul className="divide-y divide-rule rounded-lg border border-rule">
        {status.domains.map((d) => (
          <li key={d.domain} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] text-ink">{d.domain}</span>
              {d.primary && <span className="rounded-full bg-ink/6 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-ink-soft uppercase">Dashboard</span>}
              {d.default && <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent uppercase">Default</span>}
              <span className="text-xs text-ink-soft">
                {d.apps} app{d.apps === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!d.default && (
                <Button size="sm" variant="quiet" className="text-xs" busy={busy === `default:${d.domain}`} onClick={() => run(`default:${d.domain}`, () => api.cloudflareSetDefaultDomain(d.domain))}>
                  Make default
                </Button>
              )}
              {!d.primary && removing !== d.domain && (
                <Button
                  size="sm"
                  variant="quiet"
                  className="text-xs text-port hover:bg-port/10"
                  disabled={d.apps > 0}
                  title={d.apps > 0 ? 'Move its apps to another domain, or remove their hostnames under it, first' : undefined}
                  onClick={() => setRemoving(d.domain)}
                >
                  Remove
                </Button>
              )}
            </div>
            {removing === d.domain && (
              <form
                className="flex w-full flex-wrap items-end gap-2 pt-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  run(`remove:${d.domain}`, () => api.cloudflareRemoveDomain(d.domain, removeToken.trim() || undefined), () => {
                    setRemoving(null)
                    setRemoveToken('')
                  })
                }}
              >
                {automatic && !saved && (
                  <Field label="Cloudflare API token (optional)" hint="With a token, the tunnel route and DNS record are removed too. Without one, only Dockyard forgets the domain.">
                    <TextInput type="password" value={removeToken} onChange={(e) => setRemoveToken(e.target.value)} autoComplete="off" className="font-mono text-xs" />
                  </Field>
                )}
                <Button type="submit" size="sm" variant="danger" className="text-xs" busy={busy === `remove:${d.domain}`}>
                  Remove {d.domain}
                </Button>
                <Button type="button" size="sm" variant="quiet" className="text-xs" onClick={() => setRemoving(null)}>
                  Cancel
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <ErrorNote error={error} />

      {adding && automatic && (
        <div className="space-y-4 rounded-lg border border-rule bg-paper/50 p-4">
          {!zones && saved ? (
            <p className="text-sm text-ink-soft">{busy === 'check' ? 'Loading your domains…' : 'Could not list your domains with the saved token.'}</p>
          ) : !zones ? (
            <form onSubmit={checkToken} className="space-y-3">
              <Field
                label="Cloudflare API token"
                hint={'The same kind of token as at setup, covering the domain you want to add. Run "Set up again" once to have Dockyard keep it.'}
              >
                <TextInput type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} autoComplete="off" className="font-mono text-xs" required />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" busy={busy === 'check'}>
                  Check token
                </Button>
                <Button type="button" size="sm" variant="quiet" onClick={resetAdd}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                run('add', () => api.cloudflareAddDomain({ apiToken, zoneId, replaceDns }), resetAdd)
              }}
              className="space-y-3"
            >
              {available.length === 0 ? (
                <p className="text-sm text-ink-soft">Every domain this token can see is already configured.</p>
              ) : (
                <>
                  <Field label="Domain to add" hint="Must be in the same Cloudflare account as the tunnel.">
                    <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                      {available.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={replaceDns} onChange={(e) => setReplaceDns(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
                    <span>
                      Replace existing DNS records
                      <span className="block text-xs text-ink-soft">Only needed if the domain already has a wildcard (*) record pointing somewhere else.</span>
                    </span>
                  </label>
                </>
              )}
              <div className="flex items-center gap-2">
                {available.length > 0 && (
                  <Button type="submit" size="sm" variant="primary" busy={busy === 'add'}>
                    Add domain
                  </Button>
                )}
                <Button type="button" size="sm" variant="quiet" onClick={resetAdd}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {adding && !automatic && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run('add', () => api.cloudflareAddDomain({ domain, replaceDns: false }), resetAdd)
          }}
          className="space-y-3 rounded-lg border border-rule bg-paper/50 p-4"
        >
          <Field label="Domain" hint="You run the tunnel yourself, so add the *.domain route and the proxied wildcard CNAME in Cloudflare. The report below repeats what is needed.">
            <TextInput value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" className="font-mono text-xs" required />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="primary" busy={busy === 'add'}>
              Add domain
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={resetAdd}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
