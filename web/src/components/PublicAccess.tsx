import { useState, type FormEvent } from 'react'
import { api, type PublicAccessStatus, type SetupResult, type SetupStep } from '../api'
import { cx, useResource } from '../lib'
import { Button, ErrorNote, Field, Select, TextInput } from './ui'

const PERMISSIONS = [
  'Account · Cloudflare Tunnel · Edit',
  'Zone · Zone · Read',
  'Zone · DNS · Edit',
  'Zone · Zone WAF · Edit',
  'Zone · Bot Management · Edit (optional)',
]

const stepTone: Record<SetupStep['status'], { mark: string; tone: string }> = {
  ok: { mark: '✓', tone: 'text-starboard' },
  warning: { mark: '!', tone: 'text-warn' },
  failed: { mark: '✕', tone: 'text-port' },
}

export function SetupSteps({ steps }: { steps: SetupStep[] }) {
  if (!steps.length) return null
  return (
    <ol className="space-y-2 rounded-lg border border-rule bg-paper/50 p-4">
      {steps.map((step) => (
        <li key={step.name} className="flex gap-3 text-sm">
          <span aria-hidden className={cx('w-4 shrink-0 text-center font-semibold', stepTone[step.status].tone)}>
            {stepTone[step.status].mark}
          </span>
          <span className="min-w-0">
            <span className="font-medium text-ink">{step.name}</span>
            <span className="block text-xs text-ink-soft break-words">{step.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** The setup form, used on the first-run screen and in Settings. */
export function PublicAccessSetup({ onChange }: { onChange: (result: SetupResult) => void }) {
  const [mode, setMode] = useState<'automatic' | 'manual'>('automatic')
  const [apiToken, setApiToken] = useState('')
  const [zones, setZones] = useState<{ id: string; name: string }[] | null>(null)
  const [zoneId, setZoneId] = useState('')
  const [replaceDns, setReplaceDns] = useState(false)
  const [disableBotFightMode, setDisableBotFightMode] = useState(false)
  const [domain, setDomain] = useState('')
  const [tunnelToken, setTunnelToken] = useState('')
  const [busy, setBusy] = useState<'check' | 'setup' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [steps, setSteps] = useState<SetupStep[]>([])

  async function checkToken(e: FormEvent) {
    e.preventDefault()
    setBusy('check')
    setError(null)
    setSteps([])
    try {
      const list = await api.cloudflareZones(apiToken)
      setZones(list)
      setZoneId(list[0]?.id ?? '')
      if (!list.length) setError(new Error('That token works, but it cannot see any domains. Give it access to the domain you want to use.'))
    } catch (err) {
      setZones(null)
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  async function run(e: FormEvent) {
    e.preventDefault()
    setBusy('setup')
    setError(null)
    setSteps([])
    try {
      const result =
        mode === 'automatic'
          ? await api.cloudflareSetup({ apiToken, zoneId, replaceDns, disableBotFightMode })
          : await api.cloudflareManual({ domain, tunnelToken })
      setSteps(result.steps)
      if (result.ok) {
        setApiToken('')
        setTunnelToken('')
        setZones(null)
      }
      onChange(result)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-md border border-rule bg-paper p-0.5">
        {(
          [
            ['automatic', 'Set it up for me'],
            ['manual', 'I already have a tunnel'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            onClick={() => {
              setMode(key)
              setError(null)
              setSteps([])
            }}
            className={cx(
              'rounded px-3.5 py-1.5 text-sm font-medium transition-colors',
              mode === key ? 'bg-panel text-ink shadow-xs' : 'text-ink-soft hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'automatic' ? (
        <div className="space-y-5">
          <div className="space-y-2 text-sm text-ink-soft">
            <p>
              Paste a Cloudflare API token and Dockyard creates the tunnel, routes your domain to it, adds the DNS record and
              lets deploy hooks past bot protection. The token is used once and is not stored.
            </p>
            <p>
              Create it at{' '}
              <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                dash.cloudflare.com/profile/api-tokens
              </a>{' '}
              with <span className="font-medium text-ink">Create Custom Token</span> and these permissions:
            </p>
            <ul className="list-disc space-y-0.5 pl-5 font-mono text-xs text-ink">
              {PERMISSIONS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>

          <form onSubmit={checkToken} className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1">
              <Field label="Cloudflare API token">
                <TextInput
                  type="password"
                  autoComplete="off"
                  value={apiToken}
                  onChange={(e) => {
                    setApiToken(e.target.value)
                    setZones(null)
                  }}
                  required
                />
              </Field>
            </div>
            <Button type="submit" busy={busy === 'check'} disabled={!!busy}>Check token</Button>
          </form>

          {zones && zones.length > 0 && (
            <form onSubmit={run} className="space-y-4 border-t border-rule pt-5">
              <div className="max-w-sm">
                <Field label="Domain" hint="Apps will be served at names under this domain, such as my-app.example.com.">
                  <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={replaceDns} onChange={(e) => setReplaceDns(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
                <span>
                  Replace existing DNS records
                  <span className="block text-xs text-ink-soft">
                    Only needed if the domain already has a wildcard (*) or a "dockyard" record pointing somewhere else. Setup tells you if so.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={disableBotFightMode}
                  onChange={(e) => setDisableBotFightMode(e.target.checked)}
                  className="mt-0.5 size-4 accent-ink"
                />
                <span>
                  Turn off Bot Fight Mode for this domain if it is on
                  <span className="block text-xs text-ink-soft">
                    On Cloudflare's free plan, Bot Fight Mode can block GitHub from calling deploy hooks and cannot be skipped for one
                    address. On paid plans, Dockyard adds a skip rule for Super Bot Fight Mode instead and this is not needed.
                  </span>
                </span>
              </label>
              <Button type="submit" variant="primary" busy={busy === 'setup'} disabled={!!busy}>Set up public access</Button>
              {busy === 'setup' && <p className="text-xs text-ink-soft">This can take up to a minute.</p>}
            </form>
          )}
        </div>
      ) : (
        <form onSubmit={run} className="space-y-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>In Cloudflare's Zero Trust dashboard, create a tunnel of type Cloudflared and copy the token from its install command.</li>
            <li>
              Add a published application route: subdomain <span className="font-mono text-xs text-ink">*</span>, your domain, service{' '}
              <span className="font-mono text-xs text-ink">HTTP</span>, URL <span className="font-mono text-xs text-ink">traefik:80</span>.
            </li>
            <li>
              In the domain's DNS records, add a proxied CNAME <span className="font-mono text-xs text-ink">*</span> pointing to{' '}
              <span className="font-mono text-xs text-ink">&lt;tunnel-id&gt;.cfargotunnel.com</span>.
            </li>
          </ol>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Domain">
              <TextInput value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" className="font-mono text-[13px]" required />
            </Field>
            <Field label="Tunnel token">
              <TextInput type="password" autoComplete="off" value={tunnelToken} onChange={(e) => setTunnelToken(e.target.value)} required />
            </Field>
          </div>
          <Button type="submit" variant="primary" busy={busy === 'setup'} disabled={!!busy}>Connect</Button>
        </form>
      )}

      <ErrorNote error={error} />
      <SetupSteps steps={steps} />
    </div>
  )
}

/** Settings section: current state, on/off, and the setup form. */
export default function PublicAccess() {
  const { data: status, error, setData } = useResource(api.cloudflare, [])
  const [showSetup, setShowSetup] = useState(false)
  const [confirming, setConfirming] = useState<'off' | 'forget' | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  const [steps, setSteps] = useState<SetupStep[]>([])

  async function act(fn: () => Promise<PublicAccessStatus | SetupResult>) {
    setBusy(true)
    setActionError(null)
    setSteps([])
    try {
      const result = await fn()
      if ('steps' in result) {
        setSteps(result.steps)
        setData(result.status)
      } else {
        setData(result)
      }
    } catch (err) {
      // Changing public access can cut the very connection this page is using.
      setActionError(err instanceof TypeError ? new Error('The connection dropped while changing public access. Reload this page from the local address to see the result.') : err)
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  if (!status) return <ErrorNote error={error} />
  const viaPublic = status.enabled && window.location.hostname.endsWith(`.${status.domain}`)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm">
            {status.enabled ? (
              <>
                <span className="font-semibold text-starboard">On.</span> Apps are served at{' '}
                <span className="font-mono text-xs text-ink">https://&lt;name&gt;.{status.domain}</span>, and this dashboard at{' '}
                <a href={status.dashboardUrl} className="text-accent hover:underline">{status.dashboardUrl.replace('https://', '')}</a>.
              </>
            ) : (
              <>
                <span className="font-semibold text-ink">Off.</span> Apps are only reachable on this machine, at addresses like{' '}
                <span className="font-mono text-xs text-ink">{status.exampleAppUrl}</span>.
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {status.enabled
              ? `Connector ${status.connector === 'running' ? 'running' : 'not running'} · ${status.mode === 'automatic' ? 'set up by Dockyard' : 'using your own tunnel'} · local address still works: ${status.localDashboardUrl}`
              : status.configured
                ? `Settings for ${status.domain} are saved, so you can switch it back on without Cloudflare.`
                : 'Connect a Cloudflare domain to give every app a public HTTPS address. GitHub deploy hooks also need this.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="max-w-xs text-xs font-medium">
                {confirming === 'off'
                  ? `Stop serving on ${status.domain}?${viaPublic ? ' You are using the public address, so this page will disconnect; continue at the local address.' : ''}`
                  : 'Forget the saved Cloudflare settings? The tunnel and DNS records stay in your Cloudflare account.'}
              </span>
              <Button
                variant="danger"
                size="sm"
                busy={busy}
                onClick={() => act(confirming === 'off' ? api.cloudflareDisable : api.cloudflareForget)}
              >
                {confirming === 'off' ? 'Turn off' : 'Forget'}
              </Button>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
            </>
          ) : status.enabled ? (
            <>
              <Button size="sm" onClick={() => setShowSetup(!showSetup)}>{showSetup ? 'Hide setup' : 'Set up again'}</Button>
              <Button size="sm" onClick={() => setConfirming('off')}>Turn off</Button>
            </>
          ) : status.configured ? (
            <>
              <Button variant="primary" size="sm" busy={busy} onClick={() => act(api.cloudflareEnable)}>Turn back on</Button>
              <Button size="sm" onClick={() => setShowSetup(!showSetup)}>{showSetup ? 'Hide setup' : 'Set up again'}</Button>
              <Button variant="quiet" size="sm" onClick={() => setConfirming('forget')}>Forget</Button>
            </>
          ) : null}
        </div>
      </div>

      <ErrorNote error={actionError} />
      <SetupSteps steps={steps} />

      {(showSetup || !status.configured) && (
        <div className={cx(status.configured && 'border-t border-rule pt-5')}>
          <PublicAccessSetup
            onChange={(result) => {
              setData(result.status)
              if (result.ok) {
                // The form closes on success, so keep its report here.
                setSteps(result.steps)
                setShowSetup(false)
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
