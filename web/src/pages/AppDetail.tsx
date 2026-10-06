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
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-ink-soft">
        <Link to="/" className="hover:text-ink">Apps</Link>
        <span aria-hidden>/</span>
        <span className="truncate text-ink">{app.name}</span>
      </nav>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{app.name}</h1>
            <AppStatus state={deploying ? 'deploying' : state} />
          </div>
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex max-w-full items-center gap-1 text-accent hover:underline"
          >
            <span className="truncate">{app.url.replace('https://', '')}</span>
            <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3.5h6.5V10M12.5 3.5 4 12" />
            </svg>
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
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
          <Button variant="primary" busy={busy === 'deploy'} disabled={deploying} onClick={() => act('deploy', () => api.deploy(id))}>
            Deploy now
          </Button>
        </div>
      </div>
      {actionError != null && <div className="mt-4"><ErrorNote error={actionError} /></div>}

      <div className="mt-7 border-b border-rule">
        <nav className="-mb-px flex gap-1 overflow-x-auto overflow-y-hidden" aria-label="App sections">
          {tabs.map((t) => (
            <NavLink
              key={t.key}
              to={`/apps/${id}${t.key ? `/${t.key}` : ''}`}
              end
              className={({ isActive }) =>
                cx('border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive ? 'border-ink text-ink' : 'border-transparent text-ink-soft hover:text-ink')
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="pt-6">
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
