import { api, type AppDetail } from '../../api'
import { Card, Section } from '../../components/ui'
import { cx, shortImage, timeAgo, useResource } from '../../lib'

export default function Overview({ app }: { app: AppDetail }) {
  const { data: stats } = useResource(() => api.stats(app.id), [app.id], 10000)
  const statsByName = new Map((stats ?? []).map((s) => [s.name, s]))

  return (
    <div className="space-y-8">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Running image', <span className="font-mono text-[13px] break-all">{shortImage(app.image)}</span>],
          ['Routed service', `${app.primaryService} on port ${app.port}`],
          ['Source', app.sourceType === 'image' ? 'Single image' : 'Compose file'],
          ['Last deploy', app.lastDeployment ? timeAgo(app.lastDeployment.createdAt) : 'Never'],
        ].map(([label, value], i) => (
          <Card key={i} className="px-4 py-3.5">
            <dt className="text-[13px] text-ink-soft">{label}</dt>
            <dd className="mt-1 font-medium">{value}</dd>
          </Card>
        ))}
      </dl>

      <Section title="Containers">
        {app.containers.length === 0 ? (
          <p className="text-ink-soft">No containers yet. They appear after the first successful deploy.</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-rule bg-paper/70 text-xs tracking-wide text-ink-soft uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Service</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 font-medium">CPU</th>
                  <th className="px-4 py-2.5 font-medium">Memory</th>
                  <th className="px-4 py-2.5 font-medium">Image</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {app.containers.map((c) => {
                  const s = statsByName.get(c.name)
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-medium">{c.service}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className={cx('size-1.5 rounded-full', c.state === 'running' ? 'bg-starboard' : 'bg-port')} />
                          {c.status}
                        </span>
                        {c.health && <span className="ml-2 text-[13px] text-ink-soft">({c.health})</span>}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{s?.cpu ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">{s?.memory ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-soft">{shortImage(c.image)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </Section>
    </div>
  )
}
