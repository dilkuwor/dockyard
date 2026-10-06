import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Button, ErrorNote, Field, Logo, TextInput } from '../components/ui'
import { IconChevronRight } from '../components/Icons'

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

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
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Left: dark panel with a slowly drifting dot grid and breathing contour rings. */}
      <section aria-hidden className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="login-dots absolute inset-0" />
        <div className="login-rings absolute -bottom-[40%] -left-[20%] size-[120%]" />
        <div className="absolute -top-40 -right-40 size-[28rem] rounded-full bg-accent/30 blur-[110px]" />

        <div className="relative flex items-center gap-3">
          <span className="rounded-xl bg-white/10 p-1.5 ring-1 ring-white/15">
            <Logo className="size-7" />
          </span>
          <span className="text-lg font-bold tracking-tight">Dockyard</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-bold tracking-tight">Your own small cloud, on one machine.</h2>
          <ul className="mt-8 space-y-3.5 text-sm text-white/80">
            {[
              'Deploy from GitHub with a single push',
              'Public HTTPS on your own domain, no open ports',
              'Roll back any deployment in one click',
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span className="size-1.5 shrink-0 rounded-full bg-starboard shadow-[0_0_10px] shadow-starboard/70" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative font-mono text-[11px] tracking-wider text-white/40 uppercase">
          Self-hosted · Docker · Cloudflare Tunnel
        </p>
      </section>

      {/* Right: the sign-in form. */}
      <div className="flex min-h-screen flex-col items-center justify-center px-5 py-12 lg:min-h-0">
        <div className="w-full max-w-sm">
          {/* Login Card */}
          <form
            onSubmit={submit}
            className="space-y-6 rounded-2xl border border-rule bg-panel p-8 shadow-[0_16px_48px_-20px_rgba(15,23,42,0.28)]"
          >
            <div>
              <div className="flex items-center gap-2.5 mb-4 lg:hidden">
                <Logo className="size-7" />
                <span className="font-bold text-lg text-ink">Dockyard</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-ink">Sign in to Dockyard</h1>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                Enter your admin master key or password to manage your cloud workloads.
              </p>
            </div>

            <Field label="Admin Password">
              <div className="relative">
                <TextInput
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                  className="h-11 pr-16 font-mono text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-soft hover:text-ink px-2 py-1 rounded transition-colors"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            {capsLock && <p className="-mt-3 text-xs font-medium text-warn">Caps Lock is on.</p>}

            <ErrorNote error={error} />

            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!password}
              className="h-11 w-full gap-2 text-sm font-semibold"
            >
              <span>Sign in</span>
              <IconChevronRight className="size-4" />
            </Button>
          </form>

          <p className="text-center text-[11px] text-ink-soft/70 mt-6 flex items-center justify-center gap-1.5">
            <span className="size-1.5 rounded-full bg-starboard" />
            <span>Protected by Cloudflare Access & Traefik</span>
          </p>
        </div>
      </div>
    </div>
  )
}
