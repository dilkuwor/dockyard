import { Link } from 'react-router'
import { api, type AppDetail } from '../../api'
import { AppStatus, Card, MetricCard, ProgressBar, Section } from '../../components/ui'
import { cx, shortImage, timeAgo, useResource } from '../../lib'
import { IconServer, IconActivity, IconTerminal, IconRocket } from '../../components/Icons'

export default function Overview({ app }: { app: AppDetail }) {
  const { data: stats } = useResource(() => api.stats(app.id), [app.id], 8000)
  const statsByName = new Map((stats ?? []).map((s) => [s.name, s]))

  const parsePercent = (val?: string) => {
    if (!val) return 0
    const n = parseFloat(val.replace('%', ''))
    return isNaN(n) ? 0 : n
  }

  return (
    <div className="space-y-5">
      {/* Overview Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Active Image"
          value={<span className="block truncate font-mono text-[13px] font-semibold" title={app.image ?? ''}>{shortImage(app.image)}</span>}
          subtext={`Source: ${app.sourceType === 'image' ? 'Single Image' : 'Docker Compose'}`}
          icon={<IconServer className="size-4" />}
        />

        <MetricCard
          title="Routed Service"
          value={<span className="text-base font-semibold">{app.primaryService}</span>}
          subtext={`Port ${app.port} mapped via Traefik`}
          icon={<IconActivity className="size-4" />}
        />

        <MetricCard
          title="Containers"
          value={app.containers.length}
          subtext={`${app.containers.filter((c) => c.state === 'running').length} running`}
          icon={<IconTerminal className="size-4" />}
        />

        <MetricCard
          title="Last Deployment"
          value={app.lastDeployment ? timeAgo(app.lastDeployment.createdAt) : 'Never'}
          subtext={
            app.lastDeployment ? (
              <span className="truncate block">
                Trigger: {app.lastDeployment.trigger}
              </span>
            ) : (
              'Pending deploy'
            )
          }
          icon={<IconRocket className="size-4" />}
        />
      </div>

      {app.previewOf ? (
        <p className="rounded-lg border border-accent/25 bg-accent/5 px-4 py-2.5 text-sm">
          This is a preview of branch <span className="font-mono">{app.branch}</span>. It is removed when the branch is deleted on GitHub.{' '}
          <Link to={`/apps/${app.previewOf}`} className="font-medium text-accent hover:underline">Open the main app</Link>
        </p>
      ) : app.previewsEnabled ? (
        <Previews appId={app.id} />
      ) : null}

      {/* Containers Telemetry Table */}
      <Section title="Containers & Resource Telemetry">
        {app.containers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-rule bg-panel px-6 py-10 text-center">
            <p className="text-base font-semibold text-ink">No active containers</p>
            <p className="mt-1 text-sm text-ink-soft">
              Containers will appear here after the first successful deployment is running.
            </p>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="border-b border-rule bg-paper/70 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  <tr>
                    <th className="px-5 py-3">Service</th>
                    <th className="px-4 py-3">State & Health</th>
                    <th className="px-4 py-3 min-w-44">CPU Usage</th>
                    <th className="px-4 py-3 min-w-44">Memory Usage</th>
                    <th className="px-5 py-3">Container Image</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule text-sm">
                  {app.containers.map((c) => {
                    const s = statsByName.get(c.name)
                    const cpuPercent = parsePercent(s?.cpu)
                    const memPercent = parsePercent(s?.memoryPercent)

                    return (
                      <tr key={c.id} className="hover:bg-paper/40 transition-colors">
                        <td className="px-5 py-3.5 font-semibold text-ink">{c.service}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className={cx(
                                'size-2 rounded-full shrink-0',
                                c.state === 'running' ? 'bg-starboard animate-pulse' : 'bg-port'
                              )}
                            />
                            <span className="font-medium capitalize text-ink">{c.status}</span>
                            {c.health && (
                              <span
                                className={cx(
                                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                  c.health === 'healthy'
                                    ? 'bg-starboard/10 text-starboard'
                                    : 'bg-warn/10 text-warn'
                                )}
                              >
                                {c.health}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* CPU Bar */}
                        <td className="px-4 py-3.5">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <span className="text-ink-soft">CPU</span>
                              <span className="font-semibold text-ink tabular-nums">{s?.cpu ?? '—'}</span>
                            </div>
                            <ProgressBar
                              percent={cpuPercent}
                              tone={cpuPercent > 80 ? 'danger' : cpuPercent > 50 ? 'warn' : 'accent'}
                            />
                          </div>
                        </td>

                        {/* Memory Bar */}
                        <td className="px-4 py-3.5">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <span className="text-ink-soft truncate max-w-28" title={s?.memory}>
                                {s?.memory ? s.memory.split('/')[0]?.trim() : 'RAM'}
                              </span>
                              <span className="font-semibold text-ink tabular-nums">{s?.memoryPercent ?? '—'}</span>
                            </div>
                            <ProgressBar
                              percent={memPercent}
                              tone={memPercent > 85 ? 'danger' : memPercent > 65 ? 'warn' : 'ok'}
                            />
                          </div>
                        </td>

                        <td className="px-5 py-3.5">
                          <span
                            className="inline-block truncate max-w-56 font-mono text-xs text-ink-soft"
                            title={c.image}
                          >
                            {shortImage(c.image)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>
    </div>
  )
}


/** The preview apps spun up from this app's other branches. */
function Previews({ appId }: { appId: string }) {
  const { data: previews } = useResource(() => api.previews(appId), [appId], 8000)
  return (
    <Section title="Preview deployments">
      {!previews || previews.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule bg-panel px-5 py-6 text-sm text-ink-soft">
          No previews right now. Push a branch other than the deploy branch and it appears here with its own address.
        </p>
      ) : (
        <Card className="divide-y divide-rule overflow-hidden">
          {previews.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <Link to={`/apps/${p.id}`} className="font-semibold text-ink hover:text-accent">
                  <span className="font-mono">{p.branch}</span>
                </Link>
                <a href={p.url} target="_blank" rel="noreferrer" className="ml-3 font-mono text-xs text-ink-soft hover:text-accent hover:underline">
                  {p.url.replace(/^https?:\/\//, '')}
                </a>
              </div>
              <div className="flex items-center gap-3 text-xs text-ink-soft">
                <AppStatus state={p.state ?? 'missing'} />
                {p.lastDeployment && <span>{timeAgo(p.lastDeployment.createdAt)}</span>}
              </div>
            </div>
          ))}
        </Card>
      )}
    </Section>
  )
}
