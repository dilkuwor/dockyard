import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ApiError, type AppState, type DeploymentStatus } from '../api'
import { cx } from '../lib'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cx('size-7 shrink-0', className)}>
      <rect width="24" height="24" rx="6" fill="#0f172a" />
      <rect x="5" y="6.5" width="14" height="3" rx="1" fill="#fff" />
      <rect x="5" y="10.5" width="9" height="3" rx="1" fill="#fff" opacity=".7" />
      <rect x="5" y="14.5" width="14" height="3" rx="1" fill="#fff" opacity=".45" />
    </svg>
  )
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm'; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-9 px-3.5 text-sm' : 'h-8 px-2.5 text-[13px]',
        variant === 'primary' && 'bg-ink text-white shadow-xs hover:bg-ink/85',
        variant === 'secondary' && 'border border-rule bg-panel text-ink shadow-xs hover:bg-paper',
        variant === 'quiet' && 'text-ink-soft hover:bg-ink/5 hover:text-ink',
        variant === 'danger' && 'bg-port text-white shadow-xs hover:bg-port/90',
        className,
      )}
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-lg border border-rule bg-panel shadow-xs', className)}>{children}</div>
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] text-ink-soft">{hint}</span>}
    </label>
  )
}

const inputBase =
  'w-full rounded-md border border-rule bg-white px-3 py-2 text-sm text-ink shadow-xs placeholder:text-ink-soft/60 focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputBase, props.className)} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea spellCheck={false} {...props} className={cx(inputBase, 'font-mono text-[13px] leading-relaxed', props.className)} />
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof ApiError ? error.details : undefined
  return (
    <div role="alert" className="rounded-md border border-port/25 bg-port/5 px-4 py-3 text-sm">
      <p className="font-medium text-port">{message}</p>
      {details && details.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral'

const tones: Record<Tone, { badge: string; dot: string }> = {
  ok: { badge: 'bg-starboard/10 text-starboard', dot: 'bg-starboard' },
  warn: { badge: 'bg-warn/10 text-warn', dot: 'bg-warn' },
  danger: { badge: 'bg-port/10 text-port', dot: 'bg-port' },
  accent: { badge: 'bg-accent/10 text-accent-deep', dot: 'bg-accent' },
  neutral: { badge: 'bg-ink/5 text-ink-soft', dot: 'bg-ink-soft/60' },
}

function Badge({ tone, pulse, children }: { tone: Tone; pulse?: boolean; children: ReactNode }) {
  const t = tones[tone]
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', t.badge)}>
      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', t.dot, pulse && 'animate-pulse')} />
      {children}
    </span>
  )
}

const appStates: Record<AppState | 'deploying', { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'ok' },
  partial: { label: 'Partly running', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  missing: { label: 'Not running', tone: 'neutral' },
  deploying: { label: 'Deploying', tone: 'accent' },
}

export function AppStatus({ state }: { state: AppState | 'deploying' }) {
  const s = appStates[state]
  return <Badge tone={s.tone} pulse={state === 'deploying'}>{s.label}</Badge>
}

const deployStates: Record<DeploymentStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'In progress', tone: 'accent' },
  succeeded: { label: 'Live', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
}

export function DeployStatus({ status, superseded }: { status: DeploymentStatus; superseded?: boolean }) {
  const s = superseded ? { label: 'Succeeded', tone: 'neutral' as Tone } : deployStates[status]
  return <Badge tone={s.tone} pulse={status === 'running'}>{s.label}</Badge>
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function MetricCard({
  title,
  value,
  subtext,
  icon,
  action,
  className,
}: {
  title: string
  value: ReactNode
  subtext?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Card className={cx('flex flex-col justify-between p-4 transition-all hover:border-slate-300', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold tracking-wider text-ink-soft uppercase">{title}</span>
        {icon && <div className="text-ink-soft/70">{icon}</div>}
      </div>
      <div className="my-2">
        <div className="text-2xl font-bold tracking-tight text-ink">{value}</div>
        {subtext && <div className="mt-0.5 text-[13px] text-ink-soft">{subtext}</div>}
      </div>
      {action && <div className="mt-2 border-t border-rule/60 pt-2.5">{action}</div>}
    </Card>
  )
}

export function ProgressBar({
  percent,
  tone = 'accent',
  className,
}: {
  percent: number
  tone?: 'ok' | 'warn' | 'danger' | 'accent'
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const colors = {
    ok: 'bg-starboard',
    warn: 'bg-warn',
    danger: 'bg-port',
    accent: 'bg-accent',
  }
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-rule/70', className)}>
      <div
        className={cx('h-full rounded-full transition-all duration-300', colors[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

