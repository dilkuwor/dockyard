import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { ApiError, type AppState, type DeploymentStatus } from '../api'
import { cx } from '../lib'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'

export function Button({
  variant = 'secondary',
  busy,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[3px] px-3.5 py-2 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        variant === 'primary' && 'bg-signal text-ink hover:bg-signal-deep hover:text-white',
        variant === 'secondary' && 'border border-ink/25 bg-panel text-ink hover:border-ink/60',
        variant === 'quiet' && 'text-ink-soft hover:text-ink hover:bg-ink/5',
        variant === 'danger' && 'bg-port text-white hover:bg-port/85',
        className,
      )}
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[15px] font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-ink-soft">{hint}</span>}
    </label>
  )
}

const inputBase =
  'w-full rounded-[3px] border border-rule bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-ink focus:outline-none'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, props.className)} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea spellCheck={false} {...props} className={cx(inputBase, 'font-mono text-[13px] leading-relaxed', props.className)} />
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof ApiError ? error.details : undefined
  return (
    <div role="alert" className="border-l-4 border-port bg-port/8 px-4 py-3 text-[15px]">
      <p className="font-semibold text-port">{message}</p>
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

const appStates: Record<AppState | 'deploying', { label: string; tone: string; shape: string }> = {
  running: { label: 'Running', tone: 'text-starboard', shape: 'bg-starboard' },
  partial: { label: 'Partly running', tone: 'text-signal-deep', shape: 'bg-signal' },
  stopped: { label: 'Stopped', tone: 'text-ink-soft', shape: 'border-2 border-ink-soft' },
  missing: { label: 'Not running', tone: 'text-ink-soft', shape: 'border-2 border-dashed border-ink-soft' },
  deploying: { label: 'Deploying', tone: 'text-signal-deep', shape: 'bg-signal animate-pulse' },
}

export function AppStatus({ state }: { state: AppState | 'deploying' }) {
  const s = appStates[state]
  return (
    <span className={cx('inline-flex items-center gap-2 text-[15px] font-semibold', s.tone)}>
      <span aria-hidden className={cx('size-2.5 shrink-0', s.shape)} />
      {s.label}
    </span>
  )
}

const deployStates: Record<DeploymentStatus, { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'text-ink-soft' },
  running: { label: 'In progress', tone: 'text-signal-deep' },
  succeeded: { label: 'Live', tone: 'text-starboard' },
  failed: { label: 'Failed', tone: 'text-port' },
}

export function DeployStatus({ status, superseded }: { status: DeploymentStatus; superseded?: boolean }) {
  const s = superseded ? { label: 'Succeeded', tone: 'text-ink-soft' } : deployStates[status]
  return <span className={cx('font-semibold', s.tone)}>{s.label}</span>
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="secondary"
      className="px-2.5 py-1 text-sm"
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
    <section className="border-t border-rule pt-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}
