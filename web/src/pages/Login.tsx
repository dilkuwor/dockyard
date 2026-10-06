import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Button, ErrorNote, Field, TextInput } from '../components/ui'

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
      <form onSubmit={submit} className="w-full max-w-sm border-t-4 border-ink bg-panel p-7">
        <h1 className="font-display text-5xl leading-none font-bold">Dockyard</h1>
        <p className="mt-2 mb-7 text-ink-soft">Sign in to manage your apps.</p>
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
