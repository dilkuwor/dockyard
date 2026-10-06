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
    <div className="grid min-h-screen place-items-center px-5">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-rule bg-panel p-8 shadow-sm">
        <Logo className="size-9" />
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Sign in to Dockyard</h1>
        <p className="mt-1 mb-6 text-ink-soft">Enter the admin password to manage your apps.</p>
        <div className="space-y-4">
          <Field label="Admin password">
            <TextInput type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" busy={busy} disabled={!password} className="w-full">
            Sign in
          </Button>
        </div>
      </form>
    </div>
  )
}
