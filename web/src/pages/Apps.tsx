import { Link } from 'react-router'
import { api } from '../api'
import { AppStatus, Button, Card, ErrorNote } from '../components/ui'
import { shortImage, timeAgo, useResource } from '../lib'

export default function AppsPage() {
  const { data: apps, error } = useResource(api.listApps, [], 5000)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
        <p className="mt-1 text-ink-soft">
          {apps && apps.length > 0 ? `${apps.length} app${apps.length === 1 ? '' : 's'} on this machine.` : 'Everything deployed on this machine.'}
        </p>
      </div>
      <ErrorNote error={error} />

      {apps && apps.length === 0 && (
        <div className="rounded-lg border border-dashed border-rule bg-panel px-6 py-14 text-center">
          <p className="text-lg font-semibold">No apps yet</p>
          <p className="mx-auto mt-1.5 mb-6 max-w-md text-ink-soft">
            Deploy an image or a compose file and Dockyard gives it a live HTTPS address on your domain.
          </p>
          <Link to="/apps/new">
            <Button variant="primary" tabIndex={-1}>Create your first app</Button>
          </Link>
        </div>
      )}

      {apps && apps.length > 0 && (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[1.6fr_0.8fr_1.2fr_0.7fr] gap-4 border-b border-rule bg-paper/70 px-5 py-2.5 text-xs font-medium tracking-wide text-ink-soft uppercase md:grid">
            <span>App</span>
            <span>Status</span>
            <span>Image</span>
            <span>Last deploy</span>
          </div>
          <ul className="divide-y divide-rule">
            {apps.map((app) => {
              const deploying = app.lastDeployment?.status === 'running' || app.lastDeployment?.status === 'queued'
              return (
                <li key={app.id}>
                  <Link
                    to={`/apps/${app.id}`}
                    className="grid gap-1.5 px-5 py-4 transition-colors hover:bg-paper/70 md:grid-cols-[1.6fr_0.8fr_1.2fr_0.7fr] md:items-center md:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium">{app.name}</span>
                      <span className="block truncate text-[13px] text-ink-soft">{app.url.replace('https://', '')}</span>
                    </span>
                    <span>
                      <AppStatus state={deploying ? 'deploying' : (app.state ?? 'missing')} />
                    </span>
                    <span className="truncate font-mono text-xs text-ink-soft">{shortImage(app.image)}</span>
                    <span className="text-[13px] text-ink-soft">
                      {app.lastDeployment ? timeAgo(app.lastDeployment.createdAt) : 'Never'}
                      {app.lastDeployment?.status === 'failed' && <span className="ml-1.5 font-medium text-port">failed</span>}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
