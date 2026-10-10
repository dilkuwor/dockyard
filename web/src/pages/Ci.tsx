import { useState } from 'react'
import { Link } from 'react-router'
import { api, type GlobalHook } from '../api'
import { Button, Card, CopyButton, ErrorNote } from '../components/ui'
import { IconWebhook, IconKey } from '../components/Icons'
import { useResource } from '../lib'
import GithubAutomation from '../components/GithubAutomation'

function GlobalHookSection() {
  const { data: hook, error, setData } = useResource(api.globalHook, [])
  const [revealed, setRevealed] = useState(false)
  const [confirming, setConfirming] = useState<'rotate' | 'off' | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)

  async function change(fn: () => Promise<GlobalHook>) {
    setBusy(true)
    setActionError(null)
    try {
      const next = await fn()
      setData(next)
      setRevealed(next.enabled)
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 border-b border-rule pb-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-md bg-accent/10 p-2 text-accent">
            <IconWebhook className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">Global Deploy Hook</h2>
            <p className="text-xs text-ink-soft">
              Use a single webhook secret across all GitHub Actions workflows instead of per-app secrets.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            hook?.enabled ? 'bg-starboard/10 text-starboard' : 'bg-paper text-ink-soft'
          }`}
        >
          {hook?.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <div className="space-y-4">
        <ErrorNote error={error} />
        <ErrorNote error={actionError} />

        {hook && !hook.enabled && (
          <div className="rounded-lg border border-dashed border-rule bg-paper/50 p-5 text-center">
            <p className="text-sm text-ink-soft">
              Global deploy hook is currently turned off. Every app maintains its individual deploy hook address and secret.
            </p>
            <Button className="mt-4" variant="primary" busy={busy} onClick={() => change(api.enableGlobalHook)}>
              Turn on Global Hook
            </Button>
          </div>
        )}

        {hook?.enabled && hook.secret && (
          <div className="space-y-5">
            <p className="text-xs text-ink-soft leading-relaxed">
              Add the secret below to your GitHub repository secrets as{' '}
              <code className="font-mono text-ink font-semibold">DOCKYARD_HOOK_SECRET</code>. Dockyard matches the target app from the image name
              in the push payload.
            </p>
            <dl className="space-y-4 rounded-lg border border-rule bg-paper/40 p-4">
              <div>
                <dt className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-1">Webhook Endpoint URL</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border border-rule bg-panel px-3 py-1.5 font-mono text-xs text-ink break-all">
                    {hook.url}
                  </code>
                  <CopyButton value={hook.url} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-1">HMAC Signing Secret</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border border-rule bg-panel px-3 py-1.5 font-mono text-xs text-ink break-all">
                    {revealed ? hook.secret : `${hook.secret.slice(0, 8)}${'•'.repeat(24)}`}
                  </code>
                  <Button size="sm" onClick={() => setRevealed(!revealed)}>
                    {revealed ? 'Hide' : 'Show'}
                  </Button>
                  <CopyButton value={hook.secret} />
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
              {confirming ? (
                <>
                  <span className="text-xs font-medium text-port">
                    {confirming === 'rotate'
                      ? 'Rotate secret? All GitHub repositories will require the new secret immediately.'
                      : 'Disable global hook? Repositories relying on this secret will cease deploying.'}
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    busy={busy}
                    onClick={() => change(confirming === 'rotate' ? api.enableGlobalHook : api.disableGlobalHook)}
                  >
                    {confirming === 'rotate' ? 'Confirm Rotate' : 'Confirm Disable'}
                  </Button>
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={() => setConfirming('rotate')}>
                    Rotate secret
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => setConfirming('off')}>
                    Disable hook
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

export default function CiPage() {
  const { data: meta } = useResource(api.meta, [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Deploy Hooks</h1>
        <p className="mt-1 text-sm text-ink-soft">
          How GitHub Actions signs its deploy calls to this server, and whether Dockyard may store that secret in your repositories itself.
        </p>
      </div>

      {meta && !meta.publicAccess && (
        <div role="note" className="rounded-md border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
          This Dockyard has no public address, so GitHub cannot call it and <span className="font-mono text-xs">dockyard deploy</span> will
          not work yet. Set up public access under <Link to="/settings" className="text-accent hover:underline">Settings</Link> first.
        </div>
      )}

      {/* Global Hook Section */}
      <GlobalHookSection />

      {/* GitHub token for storing deploy hook secrets in repositories */}
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2.5 border-b border-rule pb-4">
          <div className="rounded-md bg-accent/10 p-2 text-accent">
            <IconKey className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">GitHub Automation</h2>
            <p className="text-xs text-ink-soft">
              Optional. Lets Dockyard put the deploy hook secret into your GitHub repositories during <span className="font-mono">dockyard deploy</span>.
            </p>
          </div>
        </div>
        <GithubAutomation />
      </Card>
    </div>
  )
}
