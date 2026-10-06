import { useState, type FormEvent } from 'react'
import { api, type RegistryCredential } from '../api'
import { Button, Card, ErrorNote, Field, Select, TextInput } from '../components/ui'
import { IconKey, IconCheck, IconServer, IconPlus } from '../components/Icons'
import { timeAgo, useResource } from '../lib'

const presets = [
  {
    key: 'docker.io',
    label: 'Docker Hub',
    hint: 'Use your Docker Hub username and a personal access token with read access (Account settings → Personal access tokens).',
  },
  {
    key: 'ghcr.io',
    label: 'GitHub Container Registry (ghcr.io)',
    hint: 'Use your GitHub username and a classic personal access token with the read:packages scope.',
  },
  { key: 'other', label: 'Custom / Private Registry', hint: 'Use the domain and authentication credentials provided by your container registry.' },
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
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Registry Credentials & Platform Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Configure authentication for private container registries so Dockyard can pull private images securely.
        </p>
      </div>

      <ErrorNote error={error} />
      <ErrorNote error={removeError} />

      {/* Connected Registries List */}
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2.5 border-b border-rule pb-4">
          <div className="rounded-md bg-accent/10 p-2 text-accent">
            <IconServer className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">Connected Registries</h2>
            <p className="text-xs text-ink-soft">
              Public images pull automatically without credentials. Private images use the verified keys below.
            </p>
          </div>
        </div>

        {registries && registries.length === 0 && (
          <div className="rounded-lg border border-dashed border-rule bg-paper/50 p-6 text-center text-xs text-ink-soft">
            No private registries configured. Public Docker Hub and ghcr.io images will pull anonymously.
          </div>
        )}

        {registries && registries.length > 0 && (
          <div className="rounded-lg border border-rule overflow-hidden">
            <ul className="divide-y divide-rule">
              {registries.map((r) => (
                <li key={r.registry} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 hover:bg-paper/40 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-ink">{r.name}</span>
                      {r.name !== r.registry && (
                        <span className="font-mono text-xs text-ink-soft bg-paper px-1.5 py-0.5 rounded">
                          {r.registry}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-starboard bg-starboard/10 px-2 py-0.5 rounded-full">
                        <IconCheck className="size-3" />
                        Verified
                      </span>
                    </div>
                    <span className="block text-xs text-ink-soft mt-0.5">
                      Username: <span className="font-medium text-ink">{r.username}</span>
                      {r.source === 'env'
                        ? ' · Defined in host .env file'
                        : r.updatedAt
                        ? ` · Saved ${timeAgo(r.updatedAt)}`
                        : ''}
                    </span>
                  </div>

                  {r.source === 'env' ? (
                    <span className="text-xs text-ink-soft italic">Managed by .env file</span>
                  ) : removing === r.registry ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-port">Remove credentials?</span>
                      <Button variant="danger" size="sm" onClick={() => remove(r)}>
                        Confirm
                      </Button>
                      <Button variant="quiet" size="sm" onClick={() => setRemoving(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="quiet" className="text-xs text-port hover:bg-port/10" onClick={() => setRemoving(r.registry)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Add / Replace Credentials Form */}
      <Card className="p-6">
        <form onSubmit={save} className="space-y-5">
          <div className="flex items-center gap-2.5 border-b border-rule pb-4">
            <div className="rounded-md bg-accent/10 p-2 text-accent">
              <IconKey className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">Add or Update Registry Authentication</h2>
              <p className="text-xs text-ink-soft">Credentials are verified against the registry upon saving and encrypted at rest.</p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Container Registry">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {presets.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </Select>
            </Field>

            {kind === 'other' && (
              <Field label="Registry Host Address">
                <TextInput
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="registry.example.com"
                  className="font-mono text-xs"
                  required
                />
              </Field>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Username">
              <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
            </Field>
            <Field label="Personal Access Token / Password">
              <TextInput
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="new-password"
                placeholder="ghp_•••• or token"
                required
              />
            </Field>
          </div>

          <p className="text-xs text-ink-soft">{preset.hint}</p>

          <ErrorNote error={saveError} />

          <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
            <Button type="submit" variant="primary" busy={busy} className="gap-1.5 text-xs">
              <IconPlus className="size-3.5" />
              <span>Verify & Save Credentials</span>
            </Button>
            {saved && (
              <span role="status" className="text-xs font-semibold text-starboard flex items-center gap-1.5">
                <IconCheck className="size-3.5" />
                {saved}
              </span>
            )}
          </div>
        </form>
      </Card>
    </div>
  )
}
