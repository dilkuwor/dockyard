import { useState, type FormEvent } from 'react'
import { api, type ApiToken, type GlobalHook } from '../api'
import { Button, Card, CopyButton, ErrorNote, TextInput } from '../components/ui'
import { IconWebhook, IconTerminal, IconCheck, IconKey, IconPlus } from '../components/Icons'
import { timeAgo, useResource } from '../lib'

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

export default function AgentsPage() {
  const { data: tokens, error, reload } = useResource(api.tokens, [])
  const [name, setName] = useState('')
  const [created, setCreated] = useState<(ApiToken & { token: string }) | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setActionError(null)
    try {
      setCreated(await api.createToken(name))
      setName('')
      await reload()
    } catch (err) {
      setActionError(err)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setActionError(null)
    try {
      await api.deleteToken(id)
      if (created?.id === id) setCreated(null)
      await reload()
    } catch (err) {
      setActionError(err)
    } finally {
      setRevoking(null)
    }
  }

  const origin = window.location.origin
  const token = created?.token ?? '<your token>'
  const setup = `mkdir -p ~/.config/dockyard ~/.local/bin
printf 'DOCKYARD_URL=%s\\nDOCKYARD_TOKEN=%s\\n' '${origin}' '${token}' > ~/.config/dockyard/config
chmod 600 ~/.config/dockyard/config
curl -fsS -H 'Authorization: Bearer ${token}' ${origin}/api/agent/cli -o ~/.local/bin/dockyard
chmod +x ~/.local/bin/dockyard`
  const prompt = 'Deploy this app to Dockyard. Run `dockyard guide` first and follow it.'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Agent Access & CI Automation</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Manage API tokens for autonomous AI coding agents (Claude Code, Gemini, Copilot) and configure global CI/CD webhooks.
        </p>
      </div>

      {/* Access Tokens Management */}
      <Card className="p-6 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-rule pb-4">
          <div className="rounded-md bg-accent/10 p-2 text-accent">
            <IconKey className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">Agent API Tokens</h2>
            <p className="text-xs text-ink-soft">
              Agents use these tokens to run <code className="font-mono">dockyard deploy</code> without your admin password.
            </p>
          </div>
        </div>

        <form onSubmit={create} className="flex flex-wrap items-center gap-2">
          <TextInput
            aria-label="Token name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent label (e.g. Claude Code on MacBook)"
            className="max-w-sm text-xs"
            required
          />
          <Button type="submit" variant="primary" busy={busy} className="gap-1.5 text-xs">
            <IconPlus className="size-3.5" />
            <span>Generate Token</span>
          </Button>
        </form>

        <ErrorNote error={error} />
        <ErrorNote error={actionError} />

        {created && (
          <div className="rounded-lg border border-starboard/30 bg-starboard/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-starboard">
              <IconCheck className="size-4" />
              <span>Token created for “{created.name}”. Copy it now; it cannot be shown again.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-rule bg-panel px-3 py-1.5 font-mono text-xs text-ink break-all">
                {created.token}
              </code>
              <CopyButton value={created.token} />
            </div>
          </div>
        )}

        {tokens && tokens.length === 0 && (
          <p className="text-xs text-ink-soft">No active agent tokens created yet.</p>
        )}

        {tokens && tokens.length > 0 && (
          <div className="rounded-lg border border-rule overflow-hidden">
            <ul className="divide-y divide-rule">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 hover:bg-paper/40 transition-colors">
                  <div className="min-w-0">
                    <span className="block font-semibold text-sm text-ink truncate">{t.name}</span>
                    <span className="block text-xs text-ink-soft">
                      Created {timeAgo(t.createdAt)} · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'never used'}
                    </span>
                  </div>
                  {revoking === t.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-port">Revoke token?</span>
                      <Button variant="danger" size="sm" onClick={() => revoke(t.id)}>
                        Confirm
                      </Button>
                      <Button variant="quiet" size="sm" onClick={() => setRevoking(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="quiet" className="text-xs text-port hover:bg-port/10" onClick={() => setRevoking(t.id)}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Global Hook Section */}
      <GlobalHookSection />

      {/* Connect an Agent Tutorial Snippet */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-rule pb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-md bg-accent/10 p-2 text-accent">
              <IconTerminal className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">Agent Machine Bootstrap Setup</h2>
              <p className="text-xs text-ink-soft">Run these commands once on the computer where the AI agent runs.</p>
            </div>
          </div>
          <CopyButton value={setup} label="Copy bootstrap snippet" />
        </div>

        <ol className="list-decimal space-y-2 pl-5 text-xs text-ink-soft">
          <li>Generate an agent token using the form above.</li>
          <li>Execute this setup block to install the <code className="font-mono text-ink">dockyard</code> binary and authentication config:</li>
        </ol>

        <pre className="overflow-x-auto rounded-lg scheme-dark bg-console p-4 font-mono text-xs leading-relaxed text-console-text">
          {setup}
        </pre>

        <div className="rounded-md bg-paper p-3 text-xs text-ink-soft">
          Prompt your agent: <span className="font-semibold text-ink font-mono">{prompt}</span>
        </div>
      </Card>
    </div>
  )
}
