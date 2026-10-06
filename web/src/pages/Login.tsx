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
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Left: dark panel with a slowly drifting dot grid and breathing contour rings. */}
      <section aria-hidden className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="login-dots absolute inset-0" />
        <div className="login-rings absolute -bottom-[40%] -left-[20%] size-[120%]" />
        <div className="absolute -top-40 -right-40 size-[28rem] rounded-full bg-accent/30 blur-[110px]" />

        <div className="relative flex items-center gap-3">
          <span className="rounded-lg bg-white/10 p-1 ring-1 ring-white/15">
            <Logo className="size-8" />
          </span>
          <span className="text-lg font-bold tracking-tight">Dockyard</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-bold tracking-tight">Your own small cloud, on one machine.</h2>
          <ul className="mt-8 space-y-3 text-sm text-white/75">
            {[
              'Deploy from GitHub with a single push',
              'Public HTTPS on your own domain, no open ports',
              'Roll back any deployment in one click',
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span className="size-1.5 shrink-0 rounded-full bg-starboard shadow-[0_0_10px] shadow-starboard/70" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative font-mono text-[11px] tracking-wide text-white/40 uppercase">Self-hosted · Docker · Cloudflare Tunnel</p>
      </section>

      {/* Right: the sign-in form. */}
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 lg:min-h-0">
        <div className="w-full max-w-sm">
          {/* Branding, small screens only; the panel on the left carries it on desktop. */}
          <div className="mb-8 text-center lg:hidden">
            <Logo className="mx-auto mb-4 size-10" />
            <h1 className="text-2xl font-bold tracking-tight text-ink">Dockyard</h1>
            <p className="mt-1 text-xs text-ink-soft">Self-hosted container machine control plane</p>
          </div>
          <div className="mb-6 hidden lg:block">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Sign in</h1>
            <p className="mt-1 text-sm text-ink-soft">Welcome back. Enter the admin password to continue.</p>
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
    </div>
  )
}
