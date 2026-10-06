import { useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'
import { api, type AppState } from '../api'
import { AppStatus, Button, ErrorNote } from '../components/ui'
import { cx, useResource } from '../lib'
import Overview from './app/Overview'
import Deployments from './app/Deployments'
import Environment from './app/Environment'
import Logs from './app/Logs'
import Webhook from './app/Webhook'
import Settings from './app/Settings'

const tabs = [
  { key: '', label: 'Overview' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'environment', label: 'Environment' },
  { key: 'logs', label: 'Logs' },
  { key: 'webhook', label: 'Deploy hook' },
  { key: 'settings', label: 'Settings' },
]

export default function AppDetailPage() {
  const { id = '', tab = '' } = useParams()
  const { data: app, error, reload } = useResource(() => api.getApp(id), [id], 4000)
  const [actionError, setActionError] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (error && !app) return <ErrorNote error={error} />
  if (!app) return null

  const running = app.containers.filter((c) => c.state === 'running').length
  const deploying = app.lastDeployment?.status === 'running' || app.lastDeployment?.status === 'queued'
  const state: AppState =
    app.containers.length === 0 ? 'missing' : running === app.containers.length ? 'running' : running > 0 ? 'partial' : 'stopped'

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setActionError(null)
    try {
      await fn()
      await reload()
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <Link to="/" className="text-[15px] text-ink-soft hover:text-ink">Apps</Link>
      <h1 className="mt-1 text-2xl font-semibold">{app.name}</h1>

      <a
        href={app.url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block font-display text-[clamp(2rem,6vw,4.25rem)] leading-[0.95] font-bold tracking-tight break-all decoration-signal decoration-4 underline-offset-8 hover:underline"
      >
        {app.url.replace('https://', '')}
      </a>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <AppStatus state={deploying ? 'deploying' : state} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" busy={busy === 'deploy'} disabled={deploying} onClick={() => act('deploy', () => api.deploy(id))}>
            Deploy now
          </Button>
          {state === 'stopped' ? (
            <Button busy={busy === 'start'} onClick={() => act('start', () => api.action(id, 'start'))}>Start</Button>
          ) : (
            <>
              <Button busy={busy === 'restart'} disabled={state === 'missing'} onClick={() => act('restart', () => api.action(id, 'restart'))}>
                Restart
              </Button>
              <Button busy={busy === 'stop'} disabled={state === 'missing'} onClick={() => act('stop', () => api.action(id, 'stop'))}>
                Stop
              </Button>
            </>
          )}
        </div>
      </div>
      {actionError != null && <div className="mt-4"><ErrorNote error={actionError} /></div>}

      <nav className="mt-8 flex gap-1 overflow-x-auto border-b-2 border-ink" aria-label="App sections">
        {tabs.map((t) => (
          <NavLink
            key={t.key}
            to={`/apps/${id}${t.key ? `/${t.key}` : ''}`}
            end
            className={({ isActive }) =>
              cx('-mb-0.5 border-b-4 px-3 py-2 text-[15px] font-semibold whitespace-nowrap',
                isActive ? 'border-signal text-ink' : 'border-transparent text-ink-soft hover:text-ink')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="pt-7">
        {tab === '' && <Overview app={app} />}
        {tab === 'deployments' && <Deployments app={app} onChange={reload} />}
        {tab === 'environment' && <Environment app={app} />}
        {tab === 'logs' && <Logs app={app} />}
        {tab === 'webhook' && <Webhook app={app} />}
        {tab === 'settings' && <Settings app={app} onSaved={reload} />}
      </div>
    </div>
  )
}
