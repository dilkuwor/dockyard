import { Link } from 'react-router'
import { useState, type ReactNode } from 'react'
import { api } from '../api'
import { Card, ErrorNote, MetricCard, ProgressBar } from '../components/ui'
import { IconActivity, IconAgent, IconApps, IconChevronLeft, IconChevronRight, IconServer } from '../components/Icons'
import { formatBytes, timeAgo, useResource } from '../lib'

function Panel({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card className="space-y-5 p-6">
      <div className="flex items-center gap-2.5 border-b border-rule pb-4">
        <div className="rounded-md bg-accent/10 p-2 text-accent">{icon}</div>
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="text-xs text-ink-soft">{description}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`].filter(Boolean).join(' ')
}

function healthTone(state: string): string {
  if (state === 'running' || state === 'healthy') return 'bg-starboard/10 text-starboard'
  if (state === 'unhealthy' || state === 'exited' || state === 'dead') return 'bg-port/10 text-port'
  return 'bg-warn/10 text-warn'
}

function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-rule bg-paper/50 px-4 py-5 text-xs text-ink-soft">
      <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  )
}

function LoadingValue() {
  return (
    <span role="status" aria-label="Loading" className="inline-flex items-center">
      <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent text-ink-soft" />
    </span>
  )
}

export default function HealthPage() {
  const { data, error } = useResource(api.platformHealth, [], 30_000)
  const [appPage, setAppPage] = useState(1)
  const [appPageSize, setAppPageSize] = useState(10)
  const services = data?.services ?? []
  const runningServices = services.filter((service) => service.state === 'running').length
  const stoppedServices = services.length - runningServices
  const appCount = data?.apps.length ?? 0
  const appPageCount = Math.max(1, Math.ceil(appCount / appPageSize))
  const currentAppPage = Math.min(appPage, appPageCount)
  const appPageStart = (currentAppPage - 1) * appPageSize
  const visibleApps = data?.apps.slice(appPageStart, appPageStart + appPageSize) ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Platform Health</h1>
          <p className="mt-1 text-sm text-ink-soft">Dockyard process, infrastructure services, and Docker engine storage.</p>
        </div>
        {data && <p className="text-xs text-ink-soft">Updated {timeAgo(data.checkedAt)}</p>}
      </div>

      <ErrorNote error={error} />

      {data?.docker.status === 'unavailable' && (
        <div role="status" className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-ink">
          Docker is not reachable. Dockyard is running, but service health and Docker storage metrics are unavailable.
        </div>
      )}

      <Panel
        icon={<IconActivity className="size-5" />}
        title="Platform Status"
        description="Dockyard process health and Docker engine connectivity."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Dockyard API"
            value={data?.dockyard.status === 'healthy' ? 'Healthy' : error ? 'Unavailable' : <LoadingValue />}
            subtext={data ? `Uptime ${formatUptime(data.dockyard.uptimeSeconds)}` : 'Checking server'}
            icon={<IconActivity className="size-5" />}
            tone="ok"
          />
          <MetricCard
            title="Dockyard memory"
            value={data ? formatBytes(data.dockyard.memoryBytes) : error ? 'Unavailable' : <LoadingValue />}
            subtext="API process resident memory"
            icon={<IconAgent className="size-5" />}
          />
          <MetricCard
            title="Docker engine"
            value={data?.docker.status === 'healthy' ? 'Connected' : data?.docker.status === 'unavailable' || error ? 'Unavailable' : <LoadingValue />}
            subtext={data?.docker.version ? `Engine ${data.docker.version}` : 'Container management'}
            icon={<IconServer className="size-5" />}
            tone={data?.docker.status === 'unavailable' ? 'ember' : undefined}
          />
          <MetricCard
            title="Dockyard services"
            value={data?.docker.status === 'unavailable' || error ? 'Unavailable' : data ? `${runningServices}/${services.length} running` : <LoadingValue />}
            subtext={data?.docker.status === 'unavailable' ? 'Docker connection required' : stoppedServices > 0 ? `${stoppedServices} stopped or unavailable` : 'Core compose services'}
            icon={<IconApps className="size-5" />}
            tone={stoppedServices > 0 || data?.docker.status === 'unavailable' ? 'ember' : undefined}
          />
        </div>
      </Panel>

      <Panel
        icon={<IconServer className="size-5" />}
        title="Infrastructure Services"
        description="CPU and memory are live Docker stats for running Dockyard Compose services."
      >
        {!data && !error ? (
          <LoadingState label="Checking infrastructure services…" />
        ) : !data || services.length === 0 ? (
          <div className="rounded-lg border border-dashed border-rule bg-panel px-6 py-8 text-center text-sm text-ink-soft">
            {error ? 'Could not load infrastructure services.' : data?.docker.status === 'unavailable' ? 'Connect Docker to see service status.' : 'No Dockyard Compose services were found.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-rule">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-rule bg-paper/70 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  <tr>
                    <th className="px-5 py-3">Service</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="min-w-36 px-4 py-3">CPU</th>
                    <th className="min-w-44 px-4 py-3">Memory</th>
                    <th className="px-5 py-3">Image</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {services.map((service) => {
                    const cpu = Number.parseFloat(service.cpu.replace('%', '')) || 0
                    const memoryPercent = Number.parseFloat(service.memoryPercent.replace('%', '')) || 0
                    const state = service.health || service.state
                    return (
                      <tr key={service.id} className="hover:bg-paper/40">
                        <td className="px-5 py-3.5 font-semibold text-ink">{service.name}</td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${healthTone(state)}`}>
                            {service.health || service.state}
                          </span>
                          {service.status && <span className="ml-2 text-xs text-ink-soft">{service.status}</span>}
                        </td>
                        <td className="px-4 py-3.5">
                          {service.cpu ? (
                            <div className="space-y-1">
                              <div className="text-xs font-mono tabular-nums text-ink">{service.cpu}</div>
                              <ProgressBar percent={cpu} tone={cpu > 80 ? 'danger' : cpu > 50 ? 'warn' : 'accent'} />
                            </div>
                          ) : <span className="text-ink-soft">—</span>}
                        </td>
                        <td className="px-4 py-3.5">
                          {service.memory ? (
                            <div className="space-y-1">
                              <div className="flex justify-between gap-2 text-xs font-mono tabular-nums text-ink">
                                <span>{service.memory.split('/')[0]?.trim()}</span>
                                <span>{service.memoryPercent}</span>
                              </div>
                              <ProgressBar percent={memoryPercent} tone={memoryPercent > 85 ? 'danger' : memoryPercent > 65 ? 'warn' : 'ok'} />
                            </div>
                          ) : <span className="text-ink-soft">—</span>}
                        </td>
                        <td className="max-w-64 truncate px-5 py-3.5 font-mono text-xs text-ink-soft" title={service.image}>{service.image}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        icon={<IconServer className="size-5" />}
        title="Docker Engine Storage"
        description="Totals for the whole Docker engine, including app workloads; Docker does not report a per-project storage breakdown here."
      >
        {!data && !error ? (
          <LoadingState label="Reading Docker engine storage…" />
        ) : !data || data.storage.length === 0 ? (
          <div className="rounded-lg border border-dashed border-rule bg-panel px-6 py-8 text-center text-sm text-ink-soft">
            {error ? 'Could not load Docker engine storage.' : 'Docker storage metrics are unavailable.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-rule">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-rule bg-paper/70 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  <tr>
                    <th className="px-5 py-3">Resource</th>
                    <th className="px-4 py-3">Objects</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Used</th>
                    <th className="px-5 py-3">Reclaimable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {data.storage.map((entry) => (
                    <tr key={entry.type}>
                      <td className="px-5 py-3.5 font-medium text-ink">{entry.type}</td>
                      <td className="px-4 py-3.5 tabular-nums">{entry.totalCount}</td>
                      <td className="px-4 py-3.5 tabular-nums">{entry.activeCount}</td>
                      <td className="px-4 py-3.5 font-mono text-xs tabular-nums">{entry.size}</td>
                      <td className="px-5 py-3.5 font-mono text-xs tabular-nums">{entry.reclaimable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        icon={<IconApps className="size-5" />}
        title="Storage by Dockyard App"
        description="Container writable layers and named volumes mounted by each app are attributed to it; bind mounts are excluded. Shared external volumes can overlap between apps. Image estimates include shared layers, so totals may overlap between apps."
      >
        {!data && !error ? (
          <LoadingState label="Calculating app storage…" />
        ) : !data || data.apps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-rule bg-panel px-6 py-8 text-center text-sm text-ink-soft">
            {error ? 'Could not load app storage.' : data?.docker.status === 'unavailable' ? 'Connect Docker to see app storage.' : 'No Dockyard-managed apps are registered.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-rule">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-rule bg-paper/70 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  <tr>
                    <th className="px-5 py-3">Application</th>
                    <th className="px-4 py-3">Container layer</th>
                    <th className="px-4 py-3">Named volumes</th>
                    <th className="px-5 py-3">Images (estimate)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {visibleApps.map((app) => (
                    <tr key={app.id} className="hover:bg-paper/40">
                      <td className="px-5 py-3.5">
                        <Link to={`/apps/${app.previewOf ?? app.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                          {app.name}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-ink-soft">
                          {app.previewOf ? `preview · ${app.branch ?? app.slug}` : app.slug}
                        </span>
                        <span className="ml-2 text-xs text-ink-soft">{app.containerCount} container{app.containerCount === 1 ? '' : 's'}</span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs tabular-nums">
                        {app.containerWritableBytes === null ? 'Unavailable' : formatBytes(app.containerWritableBytes)}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs tabular-nums">
                        {app.volumeBytes === null ? 'Unavailable' : formatBytes(app.volumeBytes)}
                        <span className="ml-2 font-sans text-ink-soft">{app.volumeCount} volume{app.volumeCount === 1 ? '' : 's'}</span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs tabular-nums">
                        {app.imageBytesEstimate === null ? 'Unavailable' : formatBytes(app.imageBytesEstimate)}
                        <span className="ml-2 font-sans text-ink-soft">{app.imageCount} image{app.imageCount === 1 ? '' : 's'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {appCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-2.5 text-xs text-ink-soft">
                <div className="flex items-center gap-3">
                  <span>
                    Showing {appPageStart + 1}–{Math.min(appPageStart + appPageSize, appCount)} of {appCount}
                  </span>
                  <label className="flex items-center gap-1.5">
                    <span>Per page</span>
                    <select
                      value={appPageSize}
                      onChange={(event) => {
                        setAppPageSize(Number(event.target.value))
                        setAppPage(1)
                      }}
                      className="rounded-md border border-rule bg-panel px-1.5 py-0.5 text-xs text-ink"
                    >
                      {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                </div>
                {appPageCount > 1 && (
                  <nav aria-label="Application storage pages" className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setAppPage(currentAppPage - 1)}
                      disabled={currentAppPage === 1}
                      aria-label="Previous page"
                      className="inline-flex size-7 items-center justify-center rounded-md border border-rule bg-panel text-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IconChevronLeft className="size-3.5" />
                    </button>
                    {Array.from({ length: appPageCount }, (_, index) => index + 1)
                      .filter((page) => page === 1 || page === appPageCount || Math.abs(page - currentAppPage) <= 1)
                      .reduce<(number | 'gap')[]>((pages, page) => {
                        const previous = pages[pages.length - 1]
                        if (typeof previous === 'number' && page - previous > 1) pages.push('gap')
                        pages.push(page)
                        return pages
                      }, [])
                      .map((page, index) =>
                        page === 'gap' ? (
                          <span key={`app-page-gap-${index}`} className="px-1">…</span>
                        ) : (
                          <button
                            key={page}
                            type="button"
                            onClick={() => setAppPage(page)}
                            aria-current={page === currentAppPage ? 'page' : undefined}
                            className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 font-medium ${
                              page === currentAppPage ? 'bg-accent/12 text-accent' : 'text-ink-soft hover:bg-paper hover:text-ink'
                            }`}
                          >
                            {page}
                          </button>
                        ),
                      )}
                    <button
                      type="button"
                      onClick={() => setAppPage(currentAppPage + 1)}
                      disabled={currentAppPage === appPageCount}
                      aria-label="Next page"
                      className="inline-flex size-7 items-center justify-center rounded-md border border-rule bg-panel text-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IconChevronRight className="size-3.5" />
                    </button>
                  </nav>
                )}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
