import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Button, ErrorNote, Field, TextInput } from './ui'
import { IconCheck } from './Icons'
import { timeAgo, useResource } from '../lib'

const MIN_LENGTH = 8

/** Settings card: change the dashboard password. Other signed-in sessions are signed out. */
export default function ChangePassword() {
  const { data: info, setData } = useResource(api.passwordInfo, [])
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)

  const mismatch = confirm.length > 0 && confirm !== next
  const canSubmit = current.length > 0 && next.length >= MIN_LENGTH && confirm === next

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const result = await api.changePassword(current, next)
      setData({ updatedAt: result.updatedAt })
      setCurrent('')
      setNext('')
      setConfirm('')
      setSaved(true)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs text-ink-soft">
        {info?.updatedAt ? `Last changed ${timeAgo(info.updatedAt)}.` : 'The password set when this Dockyard was first opened.'} Changing it
        signs out every other browser; this one stays signed in.
      </p>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Current Password">
          <TextInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New Password">
          <TextInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Confirm New Password">
          <TextInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
      </div>
      {next.length > 0 && next.length < MIN_LENGTH && <p className="-mt-2 text-xs text-ink-soft">At least {MIN_LENGTH} characters.</p>}
      {mismatch && <p className="-mt-2 text-xs font-medium text-warn">The new passwords do not match.</p>}

      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        <Button type="submit" variant="primary" busy={busy} disabled={!canSubmit} className="text-xs">
          Change Password
        </Button>
        {saved && (
          <span role="status" className="flex items-center gap-1.5 text-xs font-semibold text-starboard">
            <IconCheck className="size-3.5" />
            Password changed.
          </span>
        )}
      </div>
    </form>
  )
}
