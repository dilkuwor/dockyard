import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Button, ErrorNote, Field, Logo, TextInput } from '../components/ui'
import { IconArrowRight, IconEye, IconEyeOff, IconGithub, IconLock, IconRotateCw } from '../components/Icons'
import { useResource } from '../lib'

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  // On the very first visit there is no password yet, and this page creates it instead.
  const { data: status } = useResource(api.authStatus, [])
  const setup = status?.setupRequired === true
  const minLength = status?.minPasswordLength ?? 8

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  const mismatch = setup && confirm.length > 0 && confirm !== password
  const tooShort = setup && password.length > 0 && password.length < minLength
  const canSubmit = setup ? password.length >= minLength && confirm === password && code.trim().length > 0 : password.length > 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (setup) await api.setup(password, code)
      else await api.login(password)
      onSignedIn()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Left: dark panel with a slowly drifting dot grid, breathing contour rings and a container. */}
      <section aria-hidden className="relative hidden overflow-hidden bg-navy text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="login-dots absolute inset-0" />
        <div className="login-rings absolute -right-[10%] -bottom-[30%] size-[110%]" />
        <div className="absolute -top-40 -left-40 size-[28rem] rounded-full bg-accent/25 blur-[110px]" />

        <div className="relative flex items-center gap-3">
          <span className="rounded-xl bg-white/10 p-1 ring-1 ring-white/15">
            <Logo className="size-8" />
          </span>
          <span className="text-xl font-bold tracking-tight">Dockyard</span>
        </div>

        <div className="relative max-w-xl">
          <h2 className="text-5xl leading-[1.08] font-bold tracking-tight">
            Your own small cloud,
            <br />
            <span className="text-accent">on one machine</span>.
          </h2>
          <ul className="mt-10 space-y-5">
            {[
              { icon: IconGithub, tone: 'text-white', title: 'Deploy from GitHub', text: 'Build, push and deploy with a single push.' },
              { icon: IconLock, tone: 'text-starboard', title: 'Public HTTPS on your own domain', text: 'No open ports, powered by Cloudflare Tunnel.' },
              { icon: IconRotateCw, tone: 'text-starboard', title: 'One-click rollback', text: 'Roll back any deployment in one click.' },
            ].map(({ icon: Icon, tone, title, text }) => (
              <li key={title} className="flex items-center gap-4">
                <span className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/6 ring-1 ring-white/12 ${tone}`}>
                  <Icon className="size-6" />
                </span>
                <span>
                  <span className="block text-base font-semibold">{title}</span>
                  <span className="block text-sm text-white/65">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* An isometric container on a platform, drawn once in SVG. */}
        <svg viewBox="0 0 320 260" className="absolute right-2 bottom-24 hidden w-80 max-w-[38%] drop-shadow-[0_30px_40px_rgba(37,99,235,0.35)] xl:block">
          <defs>
            <linearGradient id="lp-top" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#334a7a" />
              <stop offset="1" stopColor="#1e2f55" />
            </linearGradient>
            <linearGradient id="lp-left" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1b2a4e" />
              <stop offset="1" stopColor="#0f1a33" />
            </linearGradient>
            <linearGradient id="lp-right" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#15223f" />
              <stop offset="1" stopColor="#0b1326" />
            </linearGradient>
            <linearGradient id="lp-plate" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#2563eb" stopOpacity="0.9" />
              <stop offset="1" stopColor="#60a5fa" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          {/* Platform */}
          <path d="M160 258 40 198l120-60 120 60z" fill="#0d1730" />
          <path d="M160 246 60 196l100-50 100 50z" fill="url(#lp-plate)" opacity="0.9" />
          <path d="M160 236 80 196l80-40 80 40z" fill="#0b1326" />
          {/* Container: top, left, right faces */}
          <path d="M160 48 68 94l92 46 92-46z" fill="url(#lp-top)" />
          <path d="M68 94v76l92 46v-76z" fill="url(#lp-left)" />
          <path d="M252 94v76l-92 46v-76z" fill="url(#lp-right)" />
          {/* Corrugation lines on the right face */}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} d={`M${166 + i * 14} ${137 - i * 7}v72`} stroke="#243b6b" strokeWidth="1.5" opacity="0.7" />
          ))}
          {/* Three glowing bars on the left face, the Dockyard mark */}
          <g transform="skewY(26.5)">
            <rect x="86" y="68" width="48" height="11" rx="3.5" fill="#60a5fa" />
            <rect x="86" y="87" width="34" height="11" rx="3.5" fill="#3b82f6" />
            <rect x="86" y="106" width="48" height="11" rx="3.5" fill="#2563eb" />
          </g>
          {/* Edge highlight */}
          <path d="M160 48 68 94l92 46 92-46z" fill="none" stroke="#5b8def" strokeWidth="1.2" opacity="0.6" />
          <path d="M160 140v76" stroke="#5b8def" strokeWidth="1.2" opacity="0.45" />
        </svg>

        <p className="relative font-mono text-[11px] tracking-[0.2em] text-white/40 uppercase">
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
              <div className="mb-6 flex items-center justify-center gap-2.5">
                <Logo className="size-10" />
                <span className="text-2xl font-bold tracking-tight text-ink">Dockyard</span>
              </div>
              {setup ? (
                <>
                  <h1 className="text-xl font-bold tracking-tight text-ink">Create your admin password</h1>
                  <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                    This is a fresh Dockyard. Choose the password that will manage this machine, and treat it like root.
                  </p>
                </>
              ) : (
                <h1 className="text-sm text-ink-soft">Sign in with your admin password to manage this machine.</h1>
              )}
            </div>

            <Field label="Admin Password">
              <div className="relative">
                <IconLock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-soft/70" />
                <TextInput
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  autoComplete={setup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                  placeholder="Enter your password"
                  className="h-12 pr-11 pl-10 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-ink-soft transition-colors hover:text-ink"
                >
                  {showPassword ? <IconEyeOff className="size-4" /> : <IconEye className="size-4" />}
                </button>
              </div>
            </Field>
            {capsLock && <p className="-mt-3 text-xs font-medium text-warn">Caps Lock is on.</p>}
            {tooShort && <p className="-mt-3 text-xs text-ink-soft">At least {minLength} characters.</p>}

            {setup && (
              <>
                <Field label="Confirm Password">
                  <TextInput
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="h-11 font-mono text-sm"
                    required
                  />
                </Field>
                {mismatch && <p className="-mt-3 text-xs font-medium text-warn">The passwords do not match.</p>}

                <Field
                  label="Setup Code"
                  hint={
                    <>
                      Printed in the server logs when Dockyard started, so only someone with access to the machine can do this. Run{' '}
                      <span className="font-mono">docker compose logs dockyard</span> to see it.
                    </>
                  }
                >
                  <TextInput
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXX-XXXX"
                    className="h-11 font-mono text-sm tracking-widest"
                    required
                  />
                </Field>
              </>
            )}

            <ErrorNote error={error} />

            <Button
              type="submit"
              variant="accent"
              busy={busy}
              disabled={!canSubmit}
              className="h-12 w-full gap-2 text-base font-semibold"
            >
              <span>{setup ? 'Create password & sign in' : 'Sign in'}</span>
              <IconArrowRight className="size-4" />
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
