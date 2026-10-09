import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { AppAvatar, AppStatus, Bars, Button, Card, ErrorNote, MetricCard } from '../components/ui'
import {
  IconApps,
  IconArrowRight,
  IconBox,
  IconDatabase,
  IconExternalLink,
  IconPlus,
  IconSearch,
  IconTerminal,
  IconZap,
} from '../components/Icons'
import { formatBytes, timeAgo, useResource } from '../lib'

/** "ghcr.io/owner/" on one line and "name:tag" on the next, so long image names stay readable. */
function splitImage(image: string | null): [string, string] | null {
  if (!image) return null
  const cut = image.lastIndexOf('/')
  return cut === -1 ? ['', image] : [image.slice(0, cut + 1), image.slice(cut + 1)]
}

export default function AppsPage() {
  const { data: apps, error } = useResource(api.listApps, [], 5000)
  const { data: unusedData } = useResource(api.unusedImages, [], 15000)

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all')

  const totalApps = apps?.length ?? 0
  const runningApps = apps?.filter((a) => a.state === 'running').length ?? 0
  const stoppedApps = apps?.filter((a) => a.state === 'stopped' || a.state === 'missing').length ?? 0
  const deployingApps = apps?.filter(
    (a) => a.lastDeployment?.status === 'running' || a.lastDeployment?.status === 'queued'
  ).length ?? 0

  // Deployments across all apps, newest first.
  const deployments = (apps ?? [])
    .flatMap((a) => (a.lastDeployment ? [{ app: a, deployment: a.lastDeployment }] : []))
    .sort((a, b) => b.deployment.createdAt - a.deployment.createdAt)
  const latest = deployments[0]

  // Sparklines: one bar per app, container, image or deployment, so the shape means something.
  const appBars = (apps ?? []).slice(0, 8).map((a) => (a.state === 'running' ? 3 : a.state === 'partial' ? 2 : 1))
  const containerBars = (apps ?? []).slice(0, 8).map((a) => (a.state === 'running' ? 3 : 0.6))
  const imageBars = (unusedData?.images ?? []).slice(0, 8).map((i) => i.size)
  const deployBars = deployments
    .slice(0, 8)
    .reverse()
    .map((d) => (d.deployment.status === 'succeeded' ? 3 : d.deployment.status === 'failed' ? 1 : 2))

  // The clock in the heading, refreshed every half minute.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
  const timeLine = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone?.split('/').pop()?.replace(/_/g, ' ')

  const filteredApps = (apps ?? []).filter((app) => {
    const matchesQuery =
      app.name.toLowerCase().includes(query.toLowerCase()) ||
      app.slug.toLowerCase().includes(query.toLowerCase()) ||
      (app.image ?? '').toLowerCase().includes(query.toLowerCase())
    if (!matchesQuery) return false
    if (statusFilter === 'running') return app.state === 'running'
    if (statusFilter === 'stopped') return app.state === 'stopped' || app.state === 'missing'
    return true
  })

  return (
    <div className="relative space-y-5">
      {/* A soft wash behind the heading, as in the design. */}
      <div aria-hidden className="pointer-events-none absolute -top-16 right-10 -z-10 h-56 w-96 rounded-full bg-accent/8 blur-3xl" />

      {/* Page Title & date */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Dashboard & Workloads</h1>
          <p className="mt-1 text-sm text-ink-soft sm:text-base">
            Real-time status of your self-hosted Docker workloads and infrastructure.
          </p>
        </div>
        <div className="text-left text-xs text-ink-soft sm:pt-1 sm:text-right">
          <div className="text-sm font-semibold text-ink">{dateLine}</div>
          <div className="mt-0.5">
            {timeLine}
            {zone && <> · {zone}</>}
          </div>
        </div>
      </div>

      <ErrorNote error={error} />

      {/* Top Telemetry KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          tone="accent"
          title="Applications"
          value={totalApps}
          subtext={
            totalApps > 0 ? (
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 font-medium text-starboard">
                  <span className="size-1.5 rounded-full bg-starboard" />
                  {runningApps} live
                </span>
                {stoppedApps > 0 && <span className="text-ink-soft">· {stoppedApps} stopped</span>}
                {deployingApps > 0 && <span className="font-medium text-accent">· {deployingApps} deploying</span>}
              </span>
            ) : (
              'No workloads deployed'
            )
          }
          icon={<IconApps className="size-5" />}
          chart={appBars.length > 0 ? <Bars values={appBars} tone="accent" /> : undefined}
          action={
            <Link to="/apps/new" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
              <IconPlus className="size-3.5" />
              Deploy application
              <IconArrowRight className="size-3.5" />
            </Link>
          }
        />

        <MetricCard
          tone="ok"
          title="Host Containers"
          value={runningApps > 0 ? `${runningApps} Active` : 'Idle'}
          subtext="Docker socket proxy connected"
          icon={<IconBox className="size-5" />}
          chart={containerBars.length > 0 ? <Bars values={containerBars} tone="ok" /> : undefined}
          action={
            <span className="inline-flex items-center gap-1.5 font-medium text-starboard">
              <span className="size-1.5 rounded-full bg-starboard" />
              Traefik routing healthy
            </span>
          }
        />

        <MetricCard
          tone="violet"
          title="Reclaimable Disk"
          value={unusedData ? formatBytes(unusedData.totalBytes) : '0 B'}
          subtext={`${unusedData?.images.length ?? 0} unused image${(unusedData?.images.length ?? 0) === 1 ? '' : 's'}`}
          icon={<IconDatabase className="size-5" />}
          chart={imageBars.length > 0 ? <Bars values={imageBars} tone="violet" /> : undefined}
          action={
            <Link to="/images" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
              Review and prune images
              <IconArrowRight className="size-3.5" />
            </Link>
          }
        />

        <MetricCard
          tone="ember"
          title="Recent Activity"
          value={latest ? timeAgo(latest.deployment.createdAt) : 'Never'}
          subtext={
            latest ? (
              <span className="flex items-center gap-1.5 truncate">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    latest.deployment.status === 'succeeded' ? 'bg-starboard' : latest.deployment.status === 'failed' ? 'bg-port' : 'bg-accent'
                  }`}
                />
                {latest.deployment.trigger} deploy · {latest.deployment.status}
              </span>
            ) : (
              'No deployment history'
            )
          }
          icon={<IconZap className="size-5" />}
          chart={deployBars.length > 0 ? <Bars values={deployBars} tone="ember" /> : undefined}
          action={
            latest?.deployment.status === 'running' ? (
              <span className="font-medium text-accent animate-pulse">Build in progress…</span>
            ) : latest ? (
              <Link to={`/apps/${latest.app.id}/deployments`} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                View activity
                <IconArrowRight className="size-3.5" />
              </Link>
            ) : (
              <span className="text-ink-soft">Automatic rollback ready</span>
            )
          }
        />
      </div>

      {/* Applications Workspace */}
      <Card className="overflow-hidden">
        {/* Search & Filter Toolbar */}
        <div className="flex flex-col gap-3 border-b border-rule px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex self-start rounded-lg border border-rule bg-paper p-0.5">
            {(
              [
                { id: 'all', label: `All (${totalApps})` },
                { id: 'running', label: `Running (${runningApps})` },
                { id: 'stopped', label: `Stopped (${stoppedApps})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === tab.id ? 'bg-panel font-semibold text-accent shadow-xs' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <IconSearch className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-soft/70" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, image, URL…"
              className="w-full rounded-md border border-rule bg-panel py-1.5 pr-3 pl-9 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none"
            />
          </div>
        </div>

        {/* Empty State */}
        {apps && totalApps === 0 && (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-paper text-ink-soft">
              <IconApps className="size-6" />
            </div>
            <p className="text-lg font-semibold text-ink">No applications deployed yet</p>
            <p className="mx-auto mt-1.5 mb-6 max-w-md text-sm text-ink-soft">
              Deploy an image or a Docker Compose file to get a live HTTPS address with automated CI/CD webhooks.
            </p>
            <Link to="/apps/new">
              <Button variant="primary">Create your first app</Button>
            </Link>
          </div>
        )}

        {/* Apps Data Table */}
        {apps && totalApps > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="border-b border-rule bg-paper/70 text-[11px] font-semibold tracking-wider text-ink-soft uppercase">
                <tr>
                  <th className="px-5 py-3">Application</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Routed Service</th>
                  <th className="px-4 py-3">Active Image</th>
                  <th className="px-4 py-3">Last Deploy</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule text-sm">
                {filteredApps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-ink-soft">
                      No applications matched your search criteria.
                    </td>
                  </tr>
                ) : (
                  filteredApps.map((app) => {
                    const deploying = app.lastDeployment?.status === 'running' || app.lastDeployment?.status === 'queued'
                    const image = splitImage(app.image)
                    return (
                      <tr key={app.id} className="group transition-colors hover:bg-paper/50">
                        {/* Avatar, name and live URL */}
                        <td className="min-w-64 px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <AppAvatar id={app.id} name={app.name} />
                            <div className="min-w-0">
                              <Link to={`/apps/${app.id}`} className="block truncate font-semibold text-ink transition-colors hover:text-accent">
                                {app.name}
                              </Link>
                              <a
                                href={app.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-ink-soft hover:text-accent hover:underline"
                              >
                                <span className="truncate">{app.url.replace(/^https?:\/\//, '')}</span>
                                <IconExternalLink className="size-3 shrink-0 opacity-60" />
                              </a>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <AppStatus state={deploying ? 'deploying' : (app.state ?? 'missing')} />
                        </td>

                        <td className="px-4 py-3.5 text-xs whitespace-nowrap text-ink-soft">
                          <span className="font-medium text-ink">{app.primaryService}</span>
                          <span className="ml-1 text-ink-soft/80">:{app.port}</span>
                          <span className="ml-1.5 rounded bg-paper px-1.5 py-0.5 text-[10px] text-ink-soft">{app.sourceType}</span>
                        </td>

                        <td className="min-w-44 px-4 py-3.5">
                          {image ? (
                            <span className="block font-mono text-xs leading-5 text-ink-soft" title={app.image ?? ''}>
                              {image[0] && <span className="block">{image[0]}</span>}
                              <span className="block">{image[1]}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-ink-soft/60">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-xs whitespace-nowrap text-ink-soft">
                          <div className="text-ink">{app.lastDeployment ? timeAgo(app.lastDeployment.createdAt) : 'Never'}</div>
                          {app.lastDeployment?.status === 'failed' ? (
                            <span className="font-medium text-port">Deploy failed</span>
                          ) : app.lastDeployment?.trigger ? (
                            <span className="text-[11px] text-ink-soft/70">via {app.lastDeployment.trigger}</span>
                          ) : null}
                        </td>

                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <Link to={`/apps/${app.id}/logs`} title="Open live logs">
                              <Button size="sm" variant="secondary" className="px-2">
                                <IconTerminal className="size-3.5 text-ink-soft" />
                              </Button>
                            </Link>
                            <Link to={`/apps/${app.id}`}>
                              <Button size="sm" variant="secondary">
                                Manage
                              </Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
