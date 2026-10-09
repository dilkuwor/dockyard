import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ApiError, type AppState, type DeploymentStatus } from '../api'
import { cx } from '../lib'
import { IconCheck } from './Icons'

type Variant = 'primary' | 'accent' | 'secondary' | 'quiet' | 'danger' | 'success'

/** A "D" whose left side is a stack of containers. The same drawing is public/logo.svg for the favicon. */
export function Logo({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cx('size-7 shrink-0', className)}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#bfdbfe" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id}bg)`} />
      <path d="M10 9.5h7a6.5 6.5 0 0 1 0 13h-7" fill="none" stroke={`url(#${id}d)`} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="8.4" y="13.3" width="8.6" height="2.3" rx="1.15" fill="#7dd3fc" />
      <rect x="8.4" y="17" width="8.6" height="2.3" rx="1.15" fill="#93c5fd" opacity=".9" />
    </svg>
  )
}

const avatarTones = ['bg-navy', 'bg-starboard', 'bg-accent', 'bg-violet', 'bg-ember']

/** A square tile with the app's initial, coloured by its id so each app keeps its colour. */
export function AppAvatar({ id, name, className }: { id: string; name: string; className?: string }) {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const tone = avatarTones[hash % avatarTones.length]
  return (
    <span
      aria-hidden
      className={cx('inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white', tone, className)}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
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
        variant === 'primary' && 'bg-ink text-paper shadow-xs hover:bg-ink/85',
        variant === 'accent' && 'bg-accent text-white shadow-xs hover:bg-accent-deep',
        variant === 'secondary' && 'border border-rule bg-panel text-ink shadow-xs hover:bg-paper',
        variant === 'quiet' && 'text-ink-soft hover:bg-ink/5 hover:text-ink',
        variant === 'danger' && 'bg-port text-white shadow-xs hover:bg-port/90',
        variant === 'success' && 'bg-starboard text-white shadow-xs hover:bg-starboard/90',
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
  'w-full rounded-md border border-rule bg-panel px-3 py-2 text-sm text-ink shadow-xs placeholder:text-ink-soft/60 focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none'

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
      variant={copied ? 'success' : 'secondary'}
      aria-live="polite"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? (
        <>
          <IconCheck className="size-3.5" />
          <span>Copied</span>
        </>
      ) : (
        label
      )}
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

export type MetricTone = 'accent' | 'ok' | 'violet' | 'ember'

const metricTones: Record<MetricTone, { tile: string; wash: string; bar: string }> = {
  accent: { tile: 'bg-accent/12 text-accent', wash: 'from-accent/8', bar: 'fill-accent' },
  ok: { tile: 'bg-starboard/12 text-starboard', wash: 'from-starboard/8', bar: 'fill-starboard' },
  violet: { tile: 'bg-violet/12 text-violet', wash: 'from-violet/8', bar: 'fill-violet' },
  ember: { tile: 'bg-ember/12 text-ember', wash: 'from-ember/8', bar: 'fill-ember' },
}

/** Tiny bar chart for a metric card: one bar per value, scaled to the tallest. */
export function Bars({ values: given, tone = 'accent', className }: { values: number[]; tone?: MetricTone; className?: string }) {
  // Fewer than six values are padded with empty slots on the left, so two bars still read as a chart.
  const values = given.length < 6 ? [...Array<number>(6 - given.length).fill(0), ...given] : given
  const max = Math.max(1, ...values)
  const w = 5
  const gap = 3
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${values.length * (w + gap) - gap} 24`}
      className={cx('h-7 shrink-0', metricTones[tone].bar, className)}
      style={{ width: `${(values.length * (w + gap) - gap) * 1.15}px` }}
    >
      {values.map((v, i) => {
        const h = Math.max(3, Math.round((v / max) * 24))
        return <rect key={i} x={i * (w + gap)} y={24 - h} width={w} height={h} rx="1.5" opacity={v === 0 ? 0.18 : 0.45 + (0.55 * v) / max} />
      })}
    </svg>
  )
}

export function MetricCard({
  title,
  value,
  subtext,
  icon,
  action,
  chart,
  tone,
  className,
}: {
  title: string
  value: ReactNode
  subtext?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  /** Something small at the right of the value, such as <Bars />. */
  chart?: ReactNode
  /** Colours the icon tile and gives the card a faint wash of the same colour. */
  tone?: MetricTone
  className?: string
}) {
  const t = tone ? metricTones[tone] : null
  return (
    <Card className={cx('flex flex-col justify-between px-4 py-3.5', t && `bg-linear-to-br ${t.wash} to-panel`, className)}>
      <div className="flex items-start gap-3">
        {icon && (
          <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-lg', t ? t.tile : 'bg-paper text-ink-soft')}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wider text-ink-soft uppercase">{title}</div>
          <div className="mt-0.5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl font-semibold tracking-tight text-ink">{value}</div>
              {subtext && <div className="mt-0.5 text-[13px] text-ink-soft">{subtext}</div>}
            </div>
            {chart}
          </div>
        </div>
      </div>
      {action && <div className="mt-3 border-t border-rule/70 pt-2.5 text-xs">{action}</div>}
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

