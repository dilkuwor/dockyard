import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api, type AppDetail } from '../../api'
import { Button, ErrorNote, Field, Section, TextArea, TextInput } from '../../components/ui'

export default function Settings({ app, onSaved }: { app: AppDetail; onSaved: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState(app.name)
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
      await api.updateApp(app.id, { name, port: Number(port), primaryService, compose })
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
    <div className="max-w-3xl space-y-12">
      <div className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_10rem_10rem]">
          <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Routed service"><TextInput value={primaryService} onChange={(e) => setPrimaryService(e.target.value)} /></Field>
          <Field label="Container port">
            <TextInput type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
        </div>
        <Field label="Compose file" hint="Webhook deploys update the routed service's image here automatically.">
          <TextArea value={compose} onChange={(e) => setCompose(e.target.value)} rows={14} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={busy === 'deploy'} disabled={!!busy} onClick={() => save(true)}>Save and deploy</Button>
          <Button busy={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>Save</Button>
          {saved && <span role="status" className="text-[15px] font-semibold text-starboard">{saved}</span>}
        </div>
      </div>

      <Section title="Delete app">
        <p className="mb-4 text-ink-soft">
          Stops and removes all of this app's containers, its URL and its deploy history. Type <span className="font-semibold text-ink">{app.name}</span> to confirm.
        </p>
        <div className="max-w-md space-y-3">
          <TextInput aria-label="App name to confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={removeVolumes} onChange={(e) => setRemoveVolumes(e.target.checked)} className="size-4 accent-port" />
            Also delete its volumes and the data in them
          </label>
          <ErrorNote error={deleteError} />
          <Button variant="danger" busy={busy === 'delete'} disabled={confirmName !== app.name} onClick={remove}>Delete app</Button>
        </div>
      </Section>
    </div>
  )
}
