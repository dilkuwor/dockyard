import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../api'
import { Button, ErrorNote, Field, TextArea, TextInput } from '../components/ui'
import { cx } from '../lib'

const exampleCompose = `services:
  web:
    image: ghcr.io/you/web:latest
    environment:
      REDIS_URL: redis://cache:6379
  cache:
    image: redis:7-alpine
    volumes:
      - cache-data:/data

volumes:
  cache-data: {}
`

export default function NewAppPage() {
  const navigate = useNavigate()
  const [sourceType, setSourceType] = useState<'image' | 'compose'>('image')
  const [name, setName] = useState('')
  const [image, setImage] = useState('')
  const [compose, setCompose] = useState(exampleCompose)
  const [primaryService, setPrimaryService] = useState('')
  const [port, setPort] = useState('80')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const app = await api.createApp({
        name,
        sourceType,
        image: sourceType === 'image' ? image : undefined,
        compose: sourceType === 'compose' ? compose : undefined,
        primaryService: sourceType === 'compose' ? primaryService : undefined,
        port: Number(port),
      })
      navigate(`/apps/${app.id}/deployments`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl">
      <h1 className="font-display text-5xl font-bold">New app</h1>
      <p className="mt-2 mb-8 text-ink-soft">
        Dockyard deploys it right away and gives it a random address like <span className="font-display text-ink">quiet-tide-4k2p.yourdomain</span>.
      </p>

      <div className="space-y-6">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Interview API" required autoFocus />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[15px] font-semibold">What are you deploying?</legend>
          <div className="inline-flex border border-ink/25 bg-panel p-0.5">
            {(['image', 'compose'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={sourceType === t}
                onClick={() => setSourceType(t)}
                className={cx('px-4 py-1.5 text-[15px] font-semibold', sourceType === t ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink')}
              >
                {t === 'image' ? 'A single image' : 'A compose file'}
              </button>
            ))}
          </div>
        </fieldset>

        {sourceType === 'image' ? (
          <Field label="Image" hint="Any image Docker can pull, e.g. nginx:alpine or yourname/app:latest.">
            <TextInput value={image} onChange={(e) => setImage(e.target.value)} placeholder="yourname/app:latest" className="font-mono text-sm" required />
          </Field>
        ) : (
          <>
            <Field
              label="Compose file"
              hint="Use images only (no build), named volumes only, and no ports. Dockyard handles routing."
            >
              <TextArea value={compose} onChange={(e) => setCompose(e.target.value)} rows={16} required />
            </Field>
            <Field label="Service that gets the URL" hint="Leave blank to use the first service in the file.">
              <TextInput value={primaryService} onChange={(e) => setPrimaryService(e.target.value)} placeholder="web" />
            </Field>
          </>
        )}

        <Field label="Container port" hint="The port your app listens on inside the container.">
          <TextInput type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} className="max-w-36" required />
        </Field>

        <ErrorNote error={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" busy={busy}>Create and deploy</Button>
          <Button type="button" variant="quiet" onClick={() => navigate('/')}>Cancel</Button>
        </div>
      </div>
    </form>
  )
}
