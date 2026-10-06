import { api, type AppDetail } from '../../api'
import { Section } from '../../components/ui'
import { shortImage, timeAgo, useResource } from '../../lib'

export default function Overview({ app }: { app: AppDetail }) {
  const { data: stats } = useResource(() => api.stats(app.id), [app.id], 10000)
  const statsByName = new Map((stats ?? []).map((s) => [s.name, s]))

  return (
    <div className="space-y-10">
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Running image', <span className="font-mono text-sm break-all">{shortImage(app.image)}</span>],
          ['Routed service', `${app.primaryService} on port ${app.port}`],
          ['Source', app.sourceType === 'image' ? 'Single image' : 'Compose file'],
          ['Last deploy', app.lastDeployment ? timeAgo(app.lastDeployment.createdAt) : 'Never'],
        ].map(([label, value], i) => (
          <div key={i}>
            <dt className="text-sm text-ink-soft">{label}</dt>
            <dd className="mt-0.5 text-[17px] font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Containers">
        {app.containers.length === 0 ? (
          <p className="text-ink-soft">No containers yet. They appear after the first successful deploy.</p>
        ) : (
          <div className="overflow-x-auto bg-panel">
            <table className="w-full text-left text-[15px]">
              <thead className="border-b-2 border-ink text-sm text-ink-soft">
                <tr>
                  <th className="px-4 py-2 font-semibold">Service</th>
                  <th className="px-4 py-2 font-semibold">State</th>
                  <th className="px-4 py-2 font-semibold">CPU</th>
                  <th className="px-4 py-2 font-semibold">Memory</th>
                  <th className="px-4 py-2 font-semibold">Image</th>
                </tr>
              </thead>
              <tbody>
                {app.containers.map((c) => {
                  const s = statsByName.get(c.name)
                  return (
                    <tr key={c.id} className="border-b border-rule last:border-b-0">
                      <td className="px-4 py-3 font-semibold">{c.service}</td>
                      <td className="px-4 py-3">
                        <span className={c.state === 'running' ? 'text-starboard' : 'text-port'}>{c.status}</span>
                        {c.health && <span className="ml-2 text-sm text-ink-soft">({c.health})</span>}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{s?.cpu ?? '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{s?.memory ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-[13px] text-ink-soft">{shortImage(c.image)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
