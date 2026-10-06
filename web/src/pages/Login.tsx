import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Button, ErrorNote, Field, Logo, TextInput } from '../components/ui'

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onSignedIn()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex size-12 items-center justify-center rounded-xl bg-ink text-white shadow-sm mb-4">
            <Logo className="size-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Dockyard Cloud</h1>
          <p className="mt-1 text-xs text-ink-soft">Self-hosted container machine control plane</p>
        </div>

        {/* Login Card */}
        <form onSubmit={submit} className="rounded-xl border border-rule bg-panel p-7 shadow-sm space-y-5">
          <div>
            <h2 className="text-base font-semibold text-ink">Admin Authentication</h2>
            <p className="text-xs text-ink-soft mt-0.5">Enter your server master key or admin password.</p>
          </div>

          <Field label="Admin Password">
            <TextInput
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••••••"
              className="font-mono text-sm"
              required
            />
          </Field>

          <ErrorNote error={error} />

          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={!password}
            className="w-full font-semibold"
          >
            Authenticate Session
          </Button>
        </form>

        <p className="text-center text-[11px] text-ink-soft/70 mt-6">
          Dockyard · Protected by Cloudflare Access & Traefik
        </p>
      </div>
    </div>
  )
}
