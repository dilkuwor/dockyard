import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../api'
import { Button, Card, ErrorNote, Field, TextArea, TextInput } from '../components/ui'
import { cx, useResource } from '../lib'

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
  const { data: meta } = useResource(api.meta, [])
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
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
        slug: slug.trim() || undefined,
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
      <h1 className="text-2xl font-semibold tracking-tight">New app</h1>
      <p className="mt-1 mb-6 text-ink-soft">
        Dockyard deploys it right away at the address you choose, or a random one like <span className="font-medium text-ink">quiet-tide-4k2p.{meta?.baseDomain ?? 'yourdomain'}</span>.
      </p>

      <Card className="space-y-6 p-6">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Interview API" required autoFocus />
        </Field>

        <Field label="Address" hint="Leave blank for a random one.">
          <span className="flex max-w-md">
            <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-app" className="rounded-r-none font-mono text-[13px]" />
            <span className="inline-flex items-center rounded-r-md border border-l-0 border-rule bg-paper px-3 font-mono text-[13px] whitespace-nowrap text-ink-soft">
              .{meta?.baseDomain ?? 'yourdomain'}
            </span>
          </span>
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">What are you deploying?</legend>
          <div className="inline-flex rounded-md border border-rule bg-paper p-0.5">
            {(['image', 'compose'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={sourceType === t}
                onClick={() => setSourceType(t)}
                className={cx(
                  'rounded px-3.5 py-1.5 text-sm font-medium transition-colors',
                  sourceType === t ? 'bg-panel text-ink shadow-xs' : 'text-ink-soft hover:text-ink',
                )}
              >
                {t === 'image' ? 'A single image' : 'A compose file'}
              </button>
            ))}
          </div>
        </fieldset>

        {sourceType === 'image' ? (
          <Field label="Image" hint="Any image Docker can pull, e.g. nginx:alpine or yourname/app:latest.">
            <TextInput value={image} onChange={(e) => setImage(e.target.value)} placeholder="yourname/app:latest" className="font-mono text-[13px]" required />
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
        <div className="flex gap-2 border-t border-rule pt-5">
          <Button type="submit" variant="primary" busy={busy}>Create and deploy</Button>
          <Button type="button" variant="quiet" onClick={() => navigate('/')}>Cancel</Button>
        </div>
      </Card>
    </form>
  )
}
