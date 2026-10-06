import { useState } from 'react'
import { api, type SetupResult } from '../api'
import { PublicAccessSetup, SetupSteps } from '../components/PublicAccess'
import { Button, Card, ErrorNote, Logo } from '../components/ui'
import { useResource } from '../lib'

/** Shown once, on first sign-in: choose between local-only use and a public domain. */
export default function Welcome({ onDone }: { onDone: () => void }) {
  const { data: status } = useResource(api.cloudflare, [])
  const [result, setResult] = useState<SetupResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      await api.completeOnboarding()
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  const done = result?.ok

  return (
    <div className="min-h-screen bg-paper px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="text-center">
          <Logo className="mx-auto mb-4 size-10" />
          <h1 className="text-2xl font-bold tracking-tight text-ink">Welcome to Dockyard</h1>
          <p className="mt-1 text-sm text-ink-soft">One choice before you start: how should your apps be reachable?</p>
        </div>

        <Card className="space-y-3 p-6">
          <h2 className="text-base font-semibold text-ink">On this machine only</h2>
          <p className="text-sm text-ink-soft">
            Nothing to set up. Each app gets an address that works on this computer, such as{' '}
            <span className="font-mono text-xs text-ink">{status?.exampleAppUrl ?? 'http://my-app.localhost:8080'}</span>. You can add a
            public domain later under Settings.
          </p>
          {!done && (
            <Button busy={busy} onClick={finish}>Skip for now, use local addresses</Button>
          )}
        </Card>

        <Card className="space-y-5 p-6">
          <div>
            <h2 className="text-base font-semibold text-ink">On the internet, with your own domain</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Uses a Cloudflare tunnel, so no router ports are opened. Each app gets a public HTTPS address under your domain, and
              GitHub can call Dockyard to deploy new versions. You need a domain that is already on Cloudflare.
            </p>
          </div>
          {done ? (
            <div className="space-y-4">
              <SetupSteps steps={result.steps} />
              <p className="text-sm">
                <span className="font-semibold text-starboard">Public access is on.</span> This dashboard is now also at{' '}
                <a href={result.status.dashboardUrl} className="text-accent hover:underline">{result.status.dashboardUrl}</a>.
              </p>
              <Button variant="primary" busy={busy} onClick={finish}>Continue to the dashboard</Button>
            </div>
          ) : (
            <PublicAccessSetup onChange={setResult} />
          )}
        </Card>

        <ErrorNote error={error} />
      </div>
    </div>
  )
}
