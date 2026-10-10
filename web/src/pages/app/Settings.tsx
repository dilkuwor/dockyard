import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api, type AppDetail } from '../../api'
import { useResource } from '../../lib'
import { Button, Card, ErrorNote, Field, Section, Select, TextArea, TextInput } from '../../components/ui'
import Addons from '../../components/Addons'
import Hostnames from '../../components/Hostnames'

export default function Settings({ app, onSaved }: { app: AppDetail; onSaved: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState(app.name)
  const [slug, setSlug] = useState(app.slug)
  const [domain, setDomain] = useState(app.domain ?? '')
  const [deployBranch, setDeployBranch] = useState(app.deployBranch ?? '')
  const [previewsEnabled, setPreviewsEnabled] = useState(app.previewsEnabled)
  const { data: meta } = useResource(api.meta, [])
  const domains = meta?.domains ?? []
  const [port, setPort] = useState(String(app.port))
  const [primaryService, setPrimaryService] = useState(app.primaryService)
  const [compose, setCompose] = useState(app.compose)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState('')

  const [confirmName, setConfirmName] = useState('')
  const [removeVolumes, setRemoveVolumes] = useState(false)
  const [deleteError, setDeleteError] = useState<unknown>(null)

  async function save(deploy: boolean) {
    setBusy(deploy ? 'deploy' : 'save')
    setError(null)
    setSaved('')
    try {
      await api.updateApp(app.id, { name, slug, domain, port: Number(port), primaryService, compose, deployBranch, previewsEnabled })
      if (deploy) {
        await api.deploy(app.id)
        navigate(`/apps/${app.id}/deployments`)
      } else {
        setSaved('Saved. Changes apply on the next deploy.')
      }
      onSaved()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    setDeleteError(null)
    try {
      await api.deleteApp(app.id, removeVolumes)
      navigate('/')
    } catch (err) {
      setDeleteError(err)
      setBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <Card className="space-y-6 p-5">
        <div className="grid gap-5 sm:grid-cols-[1fr_10rem_10rem]">
          <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Routed service"><TextInput value={primaryService} onChange={(e) => setPrimaryService(e.target.value)} /></Field>
          <Field label="Container port">
            <TextInput type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
        </div>
        <Field label="Address" hint="Where the app is reachable. A new name takes effect on the next deploy, and the old one stops working then. A different domain applies at once.">
          <span className="flex max-w-md">
            <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} className="rounded-r-none font-mono text-[13px]" />
            {domains.length > 1 ? (
              <Select value={domain} onChange={(e) => setDomain(e.target.value)} className="w-auto rounded-l-none border-l-0 bg-paper font-mono text-[13px]" aria-label="Domain">
                {domains.map((d) => (
                  <option key={d} value={d}>.{d}</option>
                ))}
              </Select>
            ) : (
              <span className="inline-flex items-center rounded-r-md border border-l-0 border-rule bg-paper px-3 font-mono text-[13px] whitespace-nowrap text-ink-soft">
                {app.url.replace(/^https?:\/\//, '').slice(app.slug.length)}
              </span>
            )}
          </span>
        </Field>
        <Field label="Compose file" hint="Webhook deploys update the routed service's image here automatically.">
          <TextArea value={compose} onChange={(e) => setCompose(e.target.value)} rows={14} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-5">
          <Button variant="primary" busy={busy === 'deploy'} disabled={!!busy} onClick={() => save(true)}>Save and deploy</Button>
          <Button busy={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>Save</Button>
          {saved && <span role="status" className="ml-1 font-medium text-starboard">{saved}</span>}
        </div>
      </Card>

      {!app.previewOf && (
        <Section title="Preview deployments">
          <Card className="space-y-4 p-5">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={previewsEnabled} onChange={(e) => setPreviewsEnabled(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
              <span>
                Give every other branch its own address
                <span className="block text-xs text-ink-soft">
                  A push to any branch except the deploy branch creates <span className="font-mono">{app.slug}-&lt;branch&gt;</span> with this
                  app's compose file and variables, and deleting the branch removes it. After saving, run{' '}
                  <span className="font-mono">dockyard deploy</span> once so the GitHub workflow builds every branch.
                </span>
              </span>
            </label>
            <Field label="Deploy branch" hint="Pushes to this branch deploy the app itself. Leave blank for main.">
              <TextInput value={deployBranch} onChange={(e) => setDeployBranch(e.target.value)} placeholder="main" className="max-w-xs font-mono text-[13px]" />
            </Field>
            <p className="text-xs text-ink-soft">Saved with the settings above.</p>
          </Card>
        </Section>
      )}

      <Section title="Add-ons">
        <Card className="p-5">
          <Addons app={app} onChange={onSaved} />
        </Card>
      </Section>

      <Section title="Custom hostnames">
        <Card className="p-5">
          <Hostnames app={app} onChange={onSaved} />
        </Card>
      </Section>

      <Section title="Delete app">
        <div className="rounded-lg border border-port/30 bg-panel p-5">
          <p className="mb-4 text-ink-soft">
            Stops and removes all of this app's containers, its URL and its deploy history. Type <span className="font-medium text-ink">{app.name}</span> to confirm.
          </p>
          <div className="max-w-md space-y-3">
            <TextInput aria-label="App name to confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={removeVolumes} onChange={(e) => setRemoveVolumes(e.target.checked)} className="size-4 accent-port" />
              Also delete its volumes and the data in them
            </label>
            <ErrorNote error={deleteError} />
            <Button variant="danger" busy={busy === 'delete'} disabled={confirmName !== app.name} onClick={remove}>Delete app</Button>
          </div>
        </div>
      </Section>
    </div>
  )
}
