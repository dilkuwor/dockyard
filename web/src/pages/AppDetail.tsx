import { useState } from 'react'
import { NavLink, useParams } from 'react-router'
import { api, type AppState } from '../api'
import { AppStatus, Button, ErrorNote } from '../components/ui'
import {
  IconExternalLink,
  IconCopy,
  IconCheck,
  IconPlay,
  IconSquare,
  IconRotateCw,
  IconRocket,
} from '../components/Icons'
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
  { key: 'logs', label: 'Logs', live: true },
  { key: 'webhook', label: 'Deploy hook' },
  { key: 'settings', label: 'Settings' },
]

export default function AppDetailPage() {
  const { id = '', tab = '' } = useParams()
  const { data: app, error, reload } = useResource(() => api.getApp(id), [id], 4000)
  const [actionError, setActionError] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)

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

  async function copyUrl() {
    if (!app) return
    await navigator.clipboard.writeText(app.url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 1500)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{app.name}</h1>
            <AppStatus state={deploying ? 'deploying' : state} />
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-soft">
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 font-mono hover:text-accent hover:underline"
            >
              <span className="truncate">{app.url.replace('https://', '')}</span>
              <IconExternalLink className="size-3 shrink-0" />
            </a>
            <button
              type="button"
              onClick={copyUrl}
              className="text-ink-soft hover:text-ink"
              title="Copy URL"
            >
              {copiedUrl ? <IconCheck className="size-3.5 text-starboard" /> : <IconCopy className="size-3.5" />}
            </button>
          </div>
        </div>

        {/* Action Controls Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {state === 'stopped' ? (
            <Button
              busy={busy === 'start'}
              onClick={() => act('start', () => api.action(id, 'start'))}
              className="gap-1.5 text-xs"
            >
              <IconPlay className="size-3.5 text-starboard" />
              <span>Start</span>
            </Button>
          ) : (
            <>
              <Button
                busy={busy === 'restart'}
                disabled={state === 'missing'}
                onClick={() => act('restart', () => api.action(id, 'restart'))}
                className="gap-1.5 text-xs"
              >
                <IconRotateCw className="size-3.5" />
                <span>Restart</span>
              </Button>
              <Button
                busy={busy === 'stop'}
                disabled={state === 'missing'}
                onClick={() => act('stop', () => api.action(id, 'stop'))}
                className="gap-1.5 text-xs"
              >
                <IconSquare className="size-3.5 text-port" />
                <span>Stop</span>
              </Button>
            </>
          )}

          <Button
            variant="primary"
            busy={busy === 'deploy'}
            disabled={deploying}
            onClick={() => act('deploy', () => api.deploy(id))}
            className="gap-1.5 text-xs font-semibold"
          >
            <IconRocket className="size-3.5" />
            <span>Deploy Now</span>
          </Button>
        </div>
      </div>

      {actionError != null && <ErrorNote error={actionError} />}

      {/* Segmented Tab Navigation */}
      <div className="border-b border-rule">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="App sections">
          {tabs.map((t) => (
            <NavLink
              key={t.key}
              to={`/apps/${id}${t.key ? `/${t.key}` : ''}`}
              end
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-ink text-ink font-semibold'
                    : 'border-transparent text-ink-soft hover:text-ink hover:border-rule',
                )
              }
            >
              <span>{t.label}</span>
              {t.live && (
                <span className="size-1.5 rounded-full bg-starboard animate-pulse" />
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Tab Content Panel */}
      <div>
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
