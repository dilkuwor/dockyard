import { Link } from 'react-router'
import { api } from '../api'
import { AppStatus, Button, ErrorNote } from '../components/ui'
import { shortImage, timeAgo, useResource } from '../lib'

export default function AppsPage() {
  const { data: apps, error } = useResource(api.listApps, [], 5000)

  return (
    <div>
      <h1 className="mb-6 font-display text-5xl font-bold">Apps</h1>
      <ErrorNote error={error} />

      {apps && apps.length === 0 && (
        <div className="border-2 border-dashed border-rule px-6 py-14 text-center">
          <p className="font-display text-3xl font-bold">No apps yet</p>
          <p className="mx-auto mt-2 mb-6 max-w-md text-ink-soft">
            Deploy an image or a compose file and Dockyard gives it a live HTTPS address on your domain.
          </p>
          <Link to="/apps/new">
            <Button variant="primary" tabIndex={-1}>Create your first app</Button>
          </Link>
        </div>
      )}

      {apps && apps.length > 0 && (
        <div className="bg-panel">
          <div className="hidden grid-cols-[1.6fr_0.8fr_1.2fr_0.7fr] gap-4 border-b-2 border-ink px-5 py-2.5 text-sm font-semibold text-ink-soft md:grid">
            <span>App</span>
            <span>Status</span>
            <span>Image</span>
            <span>Last deploy</span>
          </div>
          <ul>
            {apps.map((app) => {
              const deploying = app.lastDeployment?.status === 'running' || app.lastDeployment?.status === 'queued'
              return (
                <li key={app.id} className="border-b border-rule last:border-b-0">
                  <Link
                    to={`/apps/${app.id}`}
                    className="grid gap-1.5 px-5 py-4 hover:bg-white md:grid-cols-[1.6fr_0.8fr_1.2fr_0.7fr] md:items-center md:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-lg font-semibold">{app.name}</span>
                      <span className="block truncate font-display text-[17px] text-ink-soft">{app.url.replace('https://', '')}</span>
                    </span>
                    <AppStatus state={deploying ? 'deploying' : (app.state ?? 'missing')} />
                    <span className="truncate font-mono text-[13px] text-ink-soft">{shortImage(app.image)}</span>
                    <span className="text-sm text-ink-soft">
                      {app.lastDeployment ? timeAgo(app.lastDeployment.createdAt) : 'Never'}
                      {app.lastDeployment?.status === 'failed' && <span className="ml-1.5 font-semibold text-port">failed</span>}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
