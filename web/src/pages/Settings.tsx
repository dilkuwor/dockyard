import { useState, type FormEvent } from 'react'
import { api, type RegistryCredential } from '../api'
import { Button, Card, ErrorNote, Field, Section, Select, TextInput } from '../components/ui'
import { timeAgo, useResource } from '../lib'

const presets = [
  {
    key: 'docker.io',
    label: 'Docker Hub',
    hint: 'Use your Docker Hub username and a personal access token with read access (Account settings, Personal access tokens).',
  },
  {
    key: 'ghcr.io',
    label: 'GitHub Container Registry (ghcr.io)',
    hint: 'Use your GitHub username and a personal access token (classic) with the read:packages scope.',
  },
  { key: 'other', label: 'Another registry', hint: 'Use the username and password or token that registry gave you.' },
]

export default function SettingsPage() {
  const { data: registries, error, setData } = useResource(api.registries, [])
  const [kind, setKind] = useState('ghcr.io')
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [saved, setSaved] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<unknown>(null)

  const preset = presets.find((p) => p.key === kind)!
  const registry = kind === 'other' ? host : kind

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSaveError(null)
    setSaved('')
    try {
      const list = await api.saveRegistry({ registry, username, token })
      setData(list)
      setSaved(`Signed in to ${kind === 'other' ? host : preset.label} as ${username.trim()}.`)
      setUsername('')
      setToken('')
      setHost('')
    } catch (err) {
      setSaveError(err)
    } finally {
      setBusy(false)
    }
  }

  async function remove(target: RegistryCredential) {
    setRemoveError(null)
    try {
      setData(await api.removeRegistry(target.registry))
    } catch (err) {
      setRemoveError(err)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-ink-soft">Settings that apply to this whole Dockyard, not to one app.</p>
      </div>

      <Section title="Registry credentials">
        <div className="space-y-4">
          <p className="text-ink-soft">
            Dockyard signs in to these registries so it can pull private images. Public images need nothing here.
            Credentials are checked when you save them and stored encrypted.
          </p>
          <ErrorNote error={error} />
          <ErrorNote error={removeError} />

          {registries && registries.length === 0 && <p className="text-ink-soft">No registry credentials yet.</p>}
          {registries && registries.length > 0 && (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-rule">
                {registries.map((r) => (
                  <li key={r.registry} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {r.name}
                        {r.name !== r.registry && <span className="ml-2 font-mono text-[13px] font-normal text-ink-soft">{r.registry}</span>}
                      </span>
                      <span className="block text-[13px] text-ink-soft">
                        Signed in as <span className="font-medium text-ink">{r.username}</span>
                        {r.source === 'env' ? ' · set in the .env file' : r.updatedAt ? ` · saved ${timeAgo(r.updatedAt)}` : ''}
                      </span>
                    </span>
                    {r.source === 'env' ? (
                      <span className="text-[13px] text-ink-soft">Save credentials below to replace it</span>
                    ) : removing === r.registry ? (
                      <span className="flex items-center gap-2">
                        <span className="font-medium">Remove it?</span>
                        <Button variant="danger" size="sm" onClick={() => remove(r)}>Remove</Button>
                        <Button variant="quiet" size="sm" onClick={() => setRemoving(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => setRemoving(r.registry)}>Remove</Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5">
            <form onSubmit={save} className="space-y-5">
              <h3 className="font-semibold">Add or replace credentials</h3>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Registry">
                  <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                    {presets.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </Select>
                </Field>
                {kind === 'other' && (
                  <Field label="Registry address">
                    <TextInput value={host} onChange={(e) => setHost(e.target.value)} placeholder="registry.example.com" className="font-mono text-[13px]" required />
                  </Field>
                )}
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Username">
                  <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
                </Field>
                <Field label="Access token or password">
                  <TextInput type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" required />
                </Field>
              </div>
              <p className="text-[13px] text-ink-soft">{preset.hint}</p>
              <ErrorNote error={saveError} />
              <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
                <Button type="submit" variant="primary" busy={busy}>Save and sign in</Button>
                {saved && <span role="status" className="font-medium text-starboard">{saved}</span>}
              </div>
            </form>
          </Card>
        </div>
      </Section>
    </div>
  )
}
