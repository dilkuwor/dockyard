import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type ApiToken, type GlobalHook } from '../api'
import { Button, Card, CopyButton, ErrorNote, Section, TextInput } from '../components/ui'
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
    <Section title="Global deploy hook">
      <div className="space-y-4">
        <ErrorNote error={error} />
        <ErrorNote error={actionError} />
        {hook && !hook.enabled && (
          <Card className="p-5">
            <p className="text-ink-soft">
              Off. Every app has its own deploy hook address and secret, shown on its Deploy hook tab. Turn this on to use
              one secret for all apps instead, which you add to each new GitHub repository yourself.
            </p>
            <Button className="mt-4" busy={busy} onClick={() => change(api.enableGlobalHook)}>Turn on</Button>
          </Card>
        )}
        {hook?.enabled && hook.secret && (
          <Card className="p-5">
            <p className="text-ink-soft">
              On. Add the secret below to each app's GitHub repository as the Actions secret
              <span className="font-mono text-[13px] text-ink"> DOCKYARD_HOOK_SECRET</span>. Dockyard picks the app from the image name
              in the request. Any repository that holds this secret can redeploy any app here to another build of that app's
              own image, so add it only to your own repositories.
            </p>
            <dl className="mt-5 space-y-5">
              <div>
                <dt className="mb-1.5 font-medium">Hook URL</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border border-rule bg-paper px-3 py-1.5 font-mono text-[13px] break-all">{hook.url}</code>
                  <CopyButton value={hook.url} />
                </dd>
              </div>
              <div>
                <dt className="mb-1.5 font-medium">Signing secret</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border border-rule bg-paper px-3 py-1.5 font-mono text-[13px] break-all">
                    {revealed ? hook.secret : `${hook.secret.slice(0, 8)}${'•'.repeat(24)}`}
                  </code>
                  <Button size="sm" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Show'}</Button>
                  <CopyButton value={hook.secret} />
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
              {confirming ? (
                <>
                  <span className="font-medium">
                    {confirming === 'rotate'
                      ? 'Replace the secret? Deploys fail until every repository has the new one.'
                      : 'Turn it off? Repositories using this secret can no longer deploy.'}
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    busy={busy}
                    onClick={() => change(confirming === 'rotate' ? api.enableGlobalHook : api.disableGlobalHook)}
                  >
                    {confirming === 'rotate' ? 'Replace' : 'Turn off'}
                  </Button>
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={() => setConfirming('rotate')}>Replace secret</Button>
                  <Button variant="quiet" size="sm" onClick={() => setConfirming('off')}>Turn off</Button>
                </>
              )}
            </div>
          </Card>
        )}
      </div>
    </Section>
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
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-ink-soft">
          Let an AI agent or a script deploy apps here. It signs in with an access token instead of your password,
          and you can revoke the token at any time.
        </p>
      </div>

      <Section title="Access tokens">
        <div className="space-y-4">
          <form onSubmit={create} className="flex flex-wrap gap-2">
            <TextInput
              aria-label="Token name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Who will use it, e.g. Claude on my laptop"
              className="max-w-sm"
              required
            />
            <Button type="submit" variant="primary" busy={busy}>Create token</Button>
          </form>
          <ErrorNote error={error} />
          <ErrorNote error={actionError} />

          {created && (
            <div className="rounded-lg border border-starboard/30 bg-starboard/5 p-4">
              <p className="font-medium">Token for “{created.name}”. Copy it now; it is not shown again.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-rule bg-panel px-3 py-1.5 font-mono text-[13px] break-all">{created.token}</code>
                <CopyButton value={created.token} />
              </div>
            </div>
          )}

          {tokens && tokens.length === 0 && <p className="text-ink-soft">No tokens yet.</p>}
          {tokens && tokens.length > 0 && (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-rule">
                {tokens.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="block text-[13px] text-ink-soft">
                        Created {timeAgo(t.createdAt)} · {t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'never used'}
                      </span>
                    </span>
                    {revoking === t.id ? (
                      <span className="flex items-center gap-2">
                        <span className="font-medium">Revoke it?</span>
                        <Button variant="danger" size="sm" onClick={() => revoke(t.id)}>Revoke</Button>
                        <Button variant="quiet" size="sm" onClick={() => setRevoking(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => setRevoking(t.id)}>Revoke</Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </Section>

      <GlobalHookSection />

      <Section title="Connect an agent" aside={<CopyButton value={setup} label="Copy commands" />}>
        <ol className="mb-4 list-decimal space-y-1.5 pl-5">
          <li>Create a token above.</li>
          <li>
            On the machine where the agent works, run these commands. They save the server address and token, and install
            the <span className="font-mono text-[13px]">dockyard</span> command. The machine also needs
            <span className="font-mono text-[13px]"> git</span> and <span className="font-mono text-[13px]">jq</span>. The GitHub CLI
            <span className="font-mono text-[13px]"> gh</span> is only needed while the global deploy hook above is off.
          </li>
          <li>
            In an app's folder, tell the agent: <span className="font-medium text-ink">{prompt}</span>
          </li>
        </ol>
        <pre className="overflow-x-auto rounded-lg scheme-dark bg-console px-4 py-3 font-mono text-xs leading-relaxed text-console-text">{setup}</pre>
        <p className="mt-3 text-[13px] text-ink-soft">
          The agent adds a GitHub workflow to the app's repository. Each push then builds the image on GitHub, publishes it
          to GitHub Container Registry and calls the deploy hook here. With the global deploy hook on, add
          <span className="font-mono"> DOCKYARD_HOOK_SECRET</span> to the repository when you create it. The{' '}
          <Link to="/help" className="text-accent hover:underline">Help</Link> page has the full install guide and fixes for common errors.
        </p>
      </Section>
    </div>
  )
}
