import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api'
import { Button, Card, ErrorNote, Field, TextArea, TextInput } from '../components/ui'
import { IconRocket, IconServer, IconChevronLeft } from '../components/Icons'
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

  const liveDomain = slug.trim()
    ? `${slug.trim()}.${meta?.baseDomain ?? 'bytetech.cloud'}`
    : `[generated-subdomain].${meta?.baseDomain ?? 'bytetech.cloud'}`

  return (
    <div className="max-w-3xl space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs text-ink-soft">
        <Link to="/" className="inline-flex items-center gap-1 hover:text-ink font-medium">
          <IconChevronLeft className="size-3.5" />
          <span>Applications</span>
        </Link>
        <span>/</span>
        <span className="font-semibold text-ink">New Application</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Deploy New Application</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Dockyard deploys your workload immediately, assigns an automatic HTTPS certificate, and wires up live routing.
        </p>
      </div>

      <form onSubmit={submit}>
        <Card className="p-6 space-y-6 shadow-sm">
          {/* General Metadata */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Application Name">
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production API"
                required
                autoFocus
              />
            </Field>

            <Field label="Subdomain / Slug" hint="Leave blank to auto-generate a random 2-word subdomain.">
              <div className="flex">
                <TextInput
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-app"
                  className="rounded-r-none font-mono text-xs"
                />
                <span className="inline-flex items-center rounded-r-md border border-l-0 border-rule bg-paper px-2.5 font-mono text-xs text-ink-soft whitespace-nowrap">
                  .{meta?.baseDomain ?? 'domain'}
                </span>
              </div>
            </Field>
          </div>

          {/* Subdomain Preview Banner */}
          <div className="rounded-lg border border-rule/70 bg-paper/60 px-4 py-2.5 flex items-center justify-between text-xs">
            <span className="text-ink-soft">Public HTTPS Address:</span>
            <span className="font-mono font-medium text-accent">https://{liveDomain}</span>
          </div>

          {/* Workload Deployment Type Selector */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-ink">Deployment Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSourceType('image')}
                className={cx(
                  'flex items-center gap-3 rounded-lg border p-3.5 text-left transition-all',
                  sourceType === 'image'
                    ? 'border-ink bg-ink/5 shadow-xs font-semibold'
                    : 'border-rule hover:bg-paper/60 text-ink-soft hover:text-ink'
                )}
              >
                <IconServer className="size-5 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-ink">Single Image</div>
                  <div className="text-[11px] text-ink-soft">Pull any public or private Docker image</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('compose')}
                className={cx(
                  'flex items-center gap-3 rounded-lg border p-3.5 text-left transition-all',
                  sourceType === 'compose'
                    ? 'border-ink bg-ink/5 shadow-xs font-semibold'
                    : 'border-rule hover:bg-paper/60 text-ink-soft hover:text-ink'
                )}
              >
                <IconRocket className="size-5 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-ink">Docker Compose</div>
                  <div className="text-[11px] text-ink-soft">Multi-service stack with volumes & networking</div>
                </div>
              </button>
            </div>
          </div>

          {/* Configuration based on Source Type */}
          {sourceType === 'image' ? (
            <Field
              label="Container Image"
              hint="Any accessible Docker image (e.g. nginx:alpine, node:20, or ghcr.io/org/repo:tag)."
            >
              <TextInput
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="ghcr.io/username/app:latest"
                className="font-mono text-xs"
                required
              />
            </Field>
          ) : (
            <div className="space-y-4">
              <Field
                label="Docker Compose Definition"
                hint="Use images only, named volumes, and omit host ports (Dockyard routes internally)."
              >
                <TextArea
                  value={compose}
                  onChange={(e) => setCompose(e.target.value)}
                  rows={14}
                  className="font-mono text-xs"
                  required
                />
              </Field>

              <Field label="Routed Service Name" hint="The specific service that receives the public HTTP traffic (default is first service).">
                <TextInput
                  value={primaryService}
                  onChange={(e) => setPrimaryService(e.target.value)}
                  placeholder="web"
                  className="font-mono text-xs"
                />
              </Field>
            </div>
          )}

          <Field
            label="Internal Container Port"
            hint="The port your application listens on inside its container (commonly 80, 3000, 8080)."
          >
            <TextInput
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="max-w-36 font-mono text-xs"
              required
            />
          </Field>

          <ErrorNote error={error} />

          <div className="flex items-center gap-3 border-t border-rule pt-5">
            <Button type="submit" variant="primary" busy={busy} className="gap-2">
              <IconRocket className="size-4" />
              <span>Create & Deploy Application</span>
            </Button>
            <Button type="button" variant="quiet" onClick={() => navigate('/')}>
              Cancel
            </Button>
          </div>
        </Card>
      </form>
    </div>
  )
}
