import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { AppStatus, Button, Card, ErrorNote, MetricCard } from '../components/ui'
import {
  IconApps,
  IconServer,
  IconImages,
  IconRocket,
  IconSearch,
  IconExternalLink,
  IconTerminal,
} from '../components/Icons'
import { formatBytes, shortImage, timeAgo, useResource } from '../lib'

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

  // Find most recent deployment
  const lastDeployment = apps
    ?.map((a) => a.lastDeployment)
    .filter((d): d is NonNullable<typeof d> => Boolean(d))
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  // Filter apps
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
    <div className="space-y-5">
      {/* Page Title & Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard & Workloads</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Real-time status of your self-hosted Docker workloads and infrastructure.
          </p>
        </div>
        <Link to="/images">
          <Button size="md" variant="secondary" className="gap-2">
            <IconImages className="size-4" />
            <span>Storage ({unusedData ? formatBytes(unusedData.totalBytes) : '—'})</span>
          </Button>
        </Link>
      </div>

      <ErrorNote error={error} />

      {/* Top Telemetry KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Applications"
          value={totalApps}
          subtext={
            totalApps > 0 ? (
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 font-medium text-starboard">
                  <span className="size-1.5 rounded-full bg-starboard" />
                  {runningApps} live
                </span>
                {stoppedApps > 0 && (
                  <span className="text-ink-soft">· {stoppedApps} stopped</span>
                )}
                {deployingApps > 0 && (
                  <span className="font-medium text-accent">· {deployingApps} deploying</span>
                )}
              </span>
            ) : (
              'No workloads deployed'
            )
          }
          icon={<IconApps className="size-5" />}
          action={
            <Link to="/apps/new" className="text-xs font-medium text-accent hover:underline">
              + Deploy application
            </Link>
          }
        />

        <MetricCard
          title="Host Containers"
          value={runningApps > 0 ? `${runningApps} Active` : 'Idle'}
          subtext="Docker socket proxy connected"
          icon={<IconServer className="size-5" />}
          action={
            <span className="inline-flex items-center gap-1.5 text-xs text-starboard font-medium">
              <span className="size-1.5 rounded-full bg-starboard" />
              Traefik routing healthy
            </span>
          }
        />

        <MetricCard
          title="Reclaimable Disk"
          value={unusedData ? formatBytes(unusedData.totalBytes) : '0 B'}
          subtext={`${unusedData?.images.length ?? 0} unused image${(unusedData?.images.length ?? 0) === 1 ? '' : 's'}`}
          icon={<IconImages className="size-5" />}
          action={
            <Link to="/images" className="text-xs font-medium text-accent hover:underline">
              Review and prune images →
            </Link>
          }
        />

        <MetricCard
          title="Recent Activity"
          value={lastDeployment ? timeAgo(lastDeployment.createdAt) : 'Never'}
          subtext={
            lastDeployment ? (
              <span className="truncate block">
                {lastDeployment.trigger} deploy · {lastDeployment.status}
              </span>
            ) : (
              'No deployment history'
            )
          }
          icon={<IconRocket className="size-5" />}
          action={
            lastDeployment?.status === 'running' ? (
              <span className="text-xs font-medium text-accent animate-pulse">
                Build in progress…
              </span>
            ) : (
              <span className="text-xs text-ink-soft">Automatic rollback ready</span>
            )
          }
        />
      </div>

      {/* Applications Workspace */}
      <div className="space-y-4">
        {/* Search & Filter Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Status Filter Tabs */}
          <div className="inline-flex rounded-lg border border-rule bg-paper p-0.5">
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
                  statusFilter === tab.id
                    ? 'bg-panel text-ink shadow-xs font-semibold'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <IconSearch className="pointer-events-none absolute left-3 top-2.5 size-4 text-ink-soft/70" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, image, URL…"
              className="w-full rounded-md border border-rule bg-panel pl-9 pr-3 py-1.5 text-sm text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          </div>
        </div>

        {/* Empty State */}
        {apps && totalApps === 0 && (
          <div className="rounded-xl border border-dashed border-rule bg-panel px-6 py-16 text-center">
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
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="border-b border-rule bg-paper/70 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
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
                      const deploying =
                        app.lastDeployment?.status === 'running' || app.lastDeployment?.status === 'queued'

                      return (
                        <tr
                          key={app.id}
                          className="group hover:bg-paper/50 transition-colors"
                        >
                          {/* App Name and Live URL */}
                          <td className="px-5 py-3.5 min-w-56">
                            <Link
                              to={`/apps/${app.id}`}
                              className="font-semibold text-ink hover:text-accent transition-colors block"
                            >
                              {app.name}
                            </Link>
                            <a
                              href={app.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-xs text-ink-soft hover:text-accent hover:underline mt-0.5"
                            >
                              <span>{app.url.replace('https://', '')}</span>
                              <IconExternalLink className="size-3 shrink-0 opacity-60" />
                            </a>
                          </td>

                          {/* App Status */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <AppStatus state={deploying ? 'deploying' : (app.state ?? 'missing')} />
                          </td>

                          {/* Service & Port */}
                          <td className="px-4 py-3.5 whitespace-nowrap text-xs text-ink-soft">
                            <span className="font-medium text-ink">{app.primaryService}</span>
                            <span className="ml-1 text-ink-soft/80">:{app.port}</span>
                            <span className="ml-1.5 rounded bg-paper px-1.5 py-0.5 text-[10px] text-ink-soft">
                              {app.sourceType}
                            </span>
                          </td>

                          {/* Running Image */}
                          <td className="px-4 py-3.5 min-w-44">
                            <span className="block truncate font-mono text-xs text-ink-soft" title={app.image ?? ''}>
                              {shortImage(app.image)}
                            </span>
                          </td>

                          {/* Last Deploy */}
                          <td className="px-4 py-3.5 whitespace-nowrap text-xs text-ink-soft">
                            <div>{app.lastDeployment ? timeAgo(app.lastDeployment.createdAt) : 'Never'}</div>
                            {app.lastDeployment?.status === 'failed' ? (
                              <span className="font-medium text-port">Deploy failed</span>
                            ) : app.lastDeployment?.trigger ? (
                              <span className="text-[11px] text-ink-soft/70">via {app.lastDeployment.trigger}</span>
                            ) : null}
                          </td>

                          {/* Quick Actions */}
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <Link to={`/apps/${app.id}/logs`} title="Open live logs">
                                <Button size="sm" variant="quiet" className="px-2">
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
          </Card>
        )}
      </div>
    </div>
  )
}
