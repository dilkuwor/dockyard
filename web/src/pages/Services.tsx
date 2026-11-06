import { useState } from 'react'
import { Link } from 'react-router'
import { api, type SharedService } from '../api'
import { Button, Card, CopyIconButton, ErrorNote, MetricCard, ProgressBar, TextInput } from '../components/ui'
import { IconDatabase, IconEye, IconEyeOff, IconPlay, IconRotateCw, IconSquare, IconTerminal } from '../components/Icons'
import { timeAgo, useResource } from '../lib'

function stateTone(state: SharedService['state'], health: string): string {
  if (state === 'running' && health === 'unhealthy') return 'bg-port/10 text-port'
  if (state === 'running') return 'bg-starboard/10 text-starboard'
  if (state === 'stopped') return 'bg-warn/10 text-warn'
  return 'bg-ink/5 text-ink-soft'
}

function stateLabel(service: SharedService): string {
  if (service.state === 'missing') return 'Not started'
  if (service.state === 'stopped') return 'Stopped'
  return service.health === 'unhealthy' ? 'Unhealthy' : service.health === 'starting' ? 'Starting' : 'Running'
}

/**
 * Publishing the server on a port of the machine Dockyard runs on, for pgAdmin, psql or an IDE.
 * Reachable at whatever name points at that machine: localhost here, the dashboard's hostname when
 * DNS resolves it to the machine itself. Encrypted with the server's own certificate.
 */
function DirectAccess({ service, onChange }: { service: SharedService; onChange: () => void }) {
  const on = service.accessPort !== null
  const [port, setPort] = useState(String(service.accessPort ?? 5432))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [credentials, setCredentials] = useState<{ user: string; password: string; url: string | null } | null>(null)
  const [reveal, setReveal] = useState(false)

  async function apply(next: number | null) {
    setBusy(true)
    setError(null)
    try {
      await api.setServiceAccess(service.type, next)
      if (next === null) setCredentials(null)
      onChange()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function show() {
    setError(null)
    try {
      setCredentials(await api.serviceCredentials(service.type))
      setReveal(false)
    } catch (err) {
      setError(err)
    }
  }

  const pending = on && service.state === 'running' && service.publishedPort !== service.accessPort
  const address = `${service.accessHost}:${service.accessPort ?? ''}`

  return (
    <div className="space-y-3 rounded-lg border border-rule p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Direct access</h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            Publish the server on a port of the machine Dockyard runs on, so pgAdmin, psql or an IDE can sign in as the superuser and see every
            app's database. Connections are encrypted with the server's own certificate; use <span className="font-mono">sslmode=require</span>.
          </p>
        </div>
        {on ? (
          <Button size="sm" variant="quiet" className="text-xs text-port hover:bg-port/10" busy={busy} onClick={() => apply(null)}>
            Turn off
          </Button>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void apply(Number(port))
            }}
          >
            <label className="text-xs text-ink-soft" htmlFor="pg-access-port">Port</label>
            <TextInput id="pg-access-port" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" className="w-24 font-mono text-xs" />
            <Button size="sm" type="submit" className="text-xs" busy={busy}>
              Turn on
            </Button>
          </form>
        )}
      </div>
      <ErrorNote error={error} />
      {on && (
        <div className="space-y-2 text-xs">
          {pending && (
            <p role="status" className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-ink">
              The running server still publishes port {service.publishedPort ?? 'none'}. Restart it to apply port {service.accessPort}.
            </p>
          )}
          {service.viaCloudflare && (
            <p role="status" className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-ink">
              You reached this dashboard through Cloudflare, which carries web traffic only, so{' '}
              <span className="font-mono">{service.accessHost}</span> will not answer on port {service.accessPort}. Use a hostname whose DNS record
              points straight at this machine (a DNS-only record, not proxied), or its IP address, and open the port in its firewall.
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <dt className="w-20 shrink-0 text-ink-soft">Host</dt>
              <dd className="flex items-center gap-1 font-mono text-ink">
                <span>{address}</span>
                <CopyIconButton value={address} label="Copy host and port" />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-soft">User</dt>
              <dd className="font-mono text-ink">postgres</dd>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <dt className="w-20 shrink-0 text-ink-soft">Password</dt>
              <dd className="flex items-center gap-1 font-mono text-ink">
                {credentials ? (
                  <>
                    <span>{reveal ? credentials.password : '•'.repeat(16)}</span>
                    <button type="button" aria-label={reveal ? 'Hide password' : 'Show password'} onClick={() => setReveal((v) => !v)} className="inline-flex size-7 items-center justify-center rounded-md text-ink-soft hover:bg-ink/8 hover:text-ink">
                      {reveal ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />}
                    </button>
                    <CopyIconButton value={credentials.password} label="Copy password" />
                    {credentials.url && <CopyIconButton value={credentials.url} label="Copy connection URL" />}
                  </>
                ) : (
                  <Button size="sm" variant="quiet" className="text-xs" onClick={show}>
                    Show credentials
                  </Button>
                )}
              </dd>
            </div>
          </dl>
          <p className="text-ink-soft">
            The host is the name you opened this dashboard with; any other name or address that reaches this machine works as well. Apps keep
            using <span className="font-mono">{service.host}</span> on the private network.
          </p>
        </div>
      )}
    </div>
  )
}

function ServiceCard({ service, onChange }: { service: SharedService; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [logs, setLogs] = useState<string | null>(null)

  async function act(action: 'start' | 'stop' | 'restart') {
    setBusy(action)
    setError(null)
    setConfirmStop(false)
    try {
      await api.serviceAction(service.type, action)
      onChange()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  async function showLogs() {
    setBusy('logs')
    setError(null)
    try {
      setLogs(await api.serviceLogs(service.type))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  const cpu = Number.parseFloat(service.cpu.replace('%', '')) || 0
  const memoryPercent = Number.parseFloat(service.memoryPercent.replace('%', '')) || 0
  const orphans = service.databases.filter((d) => !d.app).length

  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-violet/12 p-2 text-violet">
            <IconDatabase className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-ink">
                {service.label}
                {service.version && <span className="ml-1.5 font-normal text-ink-soft">{service.version}</span>}
              </h2>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${stateTone(service.state, service.health)}`}>
                {stateLabel(service)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">{service.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {service.state === 'running' && (
            <Button size="sm" variant="quiet" className="text-xs" busy={busy === 'logs'} onClick={showLogs}>
              <IconTerminal className="size-3.5" /> Logs
            </Button>
          )}
          {service.state === 'running' ? (
            confirmStop ? (
              <>
                <span className="text-xs text-ink-soft">Stop it? Every app using it loses its database until it starts again.</span>
                <Button size="sm" variant="danger" className="text-xs" busy={busy === 'stop'} onClick={() => act('stop')}>
                  Stop
                </Button>
                <Button size="sm" variant="quiet" className="text-xs" onClick={() => setConfirmStop(false)}>
                  Keep running
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" className="text-xs" busy={busy === 'restart'} onClick={() => act('restart')}>
                  <IconRotateCw className="size-3.5" /> Restart
                </Button>
                <Button size="sm" variant="quiet" className="text-xs text-port hover:bg-port/10" onClick={() => setConfirmStop(true)}>
                  <IconSquare className="size-3.5" /> Stop
                </Button>
              </>
            )
          ) : service.state === 'stopped' ? (
            <Button size="sm" variant="success" className="text-xs" busy={busy === 'start'} onClick={() => act('start')}>
              <IconPlay className="size-3.5" /> Start
            </Button>
          ) : null}
        </div>
      </div>

      <ErrorNote error={error} />

      {service.state === 'missing' ? (
        <p className="rounded-lg border border-dashed border-rule bg-paper/50 px-4 py-5 text-center text-sm text-ink-soft">
          Not running yet. It starts the first time an app adds the <span className="font-medium text-ink">PostgreSQL (shared server)</span> add-on on
          its Settings tab.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Apps"
              value={service.appCount}
              subtext={`${service.databases.length} database${service.databases.length === 1 ? '' : 's'}${orphans ? `, ${orphans} without an app` : ''}`}
              tone={orphans ? 'ember' : undefined}
            />
            <MetricCard title="Data" value={service.dataSize ?? '—'} subtext={`Volume ${service.volume}`} />
            <MetricCard
              title="CPU"
              value={service.cpu || '—'}
              subtext={service.cpu ? <ProgressBar percent={cpu} tone={cpu > 80 ? 'danger' : cpu > 50 ? 'warn' : 'accent'} className="mt-1.5" /> : service.status}
            />
            <MetricCard
              title="Memory"
              value={service.memory ? service.memory.split('/')[0]?.trim() : '—'}
              subtext={service.memory ? <ProgressBar percent={memoryPercent} tone={memoryPercent > 85 ? 'danger' : memoryPercent > 65 ? 'warn' : 'ok'} className="mt-1.5" /> : service.status}
            />
          </div>

          <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-soft">Host</dt>
              <dd className="font-mono text-ink">{service.host}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-soft">Network</dt>
              <dd className="font-mono text-ink">{service.network}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-soft">Container</dt>
              <dd className="font-mono text-ink">{service.container}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-soft">Image</dt>
              <dd className="truncate font-mono text-ink" title={service.image}>{service.image}</dd>
            </div>
          </dl>

          <DirectAccess service={service} onChange={onChange} />

          {service.state === 'running' && (
            <div className="overflow-hidden rounded-lg border border-rule">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-rule bg-paper/70 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  <tr>
                    <th className="px-4 py-2.5">Database</th>
                    <th className="px-4 py-2.5">App</th>
                    <th className="px-4 py-2.5 text-right">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {service.databases.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-4 text-center text-xs text-ink-soft">No databases yet.</td>
                    </tr>
                  )}
                  {service.databases.map((d) => (
                    <tr key={d.name} className="hover:bg-paper/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-ink">{d.name}</td>
                      <td className="px-4 py-2.5">
                        {d.app ? (
                          <Link to={`/apps/${d.app.id}/settings`} className="font-medium text-ink hover:text-accent hover:underline">
                            {d.app.name}
                            {d.app.previewOf && <span className="ml-1.5 text-xs font-normal text-ink-soft">preview</span>}
                          </Link>
                        ) : (
                          <span className="text-xs text-warn">No app owns this database</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-ink-soft">{d.size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {logs !== null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Recent log</h3>
                <Button size="sm" variant="quiet" className="text-xs" onClick={() => setLogs(null)}>
                  Hide
                </Button>
              </div>
              <pre className="max-h-80 overflow-auto rounded-lg border border-rule bg-ink p-3 font-mono text-[11px] leading-relaxed text-paper">
                {logs || 'The log is empty.'}
              </pre>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

export default function ServicesPage() {
  const { data, error, reload } = useResource(api.services, [], 30_000)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Shared Services</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Infrastructure Dockyard runs once for every app that asks for it, as opposed to add-ons inside an app.
          </p>
        </div>
        {data && <p className="text-xs text-ink-soft">Updated {timeAgo(data.checkedAt)}</p>}
      </div>

      <ErrorNote error={error} />

      {!data && !error && (
        <div role="status" className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-rule bg-paper/50 px-4 py-5 text-xs text-ink-soft">
          <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Checking shared services…
        </div>
      )}

      {data?.services.map((service) => (
        <ServiceCard key={service.type} service={service} onChange={() => void reload()} />
      ))}
    </div>
  )
}
