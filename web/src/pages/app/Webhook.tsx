import { useState } from 'react'
import { Link } from 'react-router'
import { api, type AppDetail } from '../../api'
import { Button, Card, CopyButton, ErrorNote, Section } from '../../components/ui'
import { cx, useResource } from '../../lib'

function workflow(imageHint: string) {
  return `name: Build and deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      IMAGE: ${imageHint}
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          username: \${{ secrets.DOCKERHUB_USERNAME }}
          password: \${{ secrets.DOCKERHUB_TOKEN }}

      - id: build
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: |
            \${{ env.IMAGE }}:latest
            \${{ env.IMAGE }}:\${{ github.sha }}

      - name: Tell Dockyard to deploy
        env:
          HOOK_URL: \${{ secrets.DOCKYARD_HOOK_URL }}
          HOOK_SECRET: \${{ secrets.DOCKYARD_HOOK_SECRET }}
          DIGEST: \${{ steps.build.outputs.digest }}
        run: |
          BODY=$(jq -nc --arg image "$IMAGE" --arg digest "$DIGEST" --arg commit "$GITHUB_SHA" \\
            '{image: $image, digest: $digest, commit: $commit}')
          TS=$(date +%s)
          SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$HOOK_SECRET" -hex | sed 's/^.* //')
          curl -fsS -X POST "$HOOK_URL" \\
            -H "Content-Type: application/json" \\
            -H "X-Dockyard-Timestamp: $TS" \\
            -H "X-Dockyard-Signature: sha256=$SIG" \\
            -d "$BODY"
`
}

function ghcrWorkflow() {
  return `name: Build and deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      # Image names on ghcr.io must be lowercase.
      - id: image
        run: echo "name=ghcr.io/\${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"

      - id: build
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: |
            \${{ steps.image.outputs.name }}:latest
            \${{ steps.image.outputs.name }}:\${{ github.sha }}

      - name: Tell Dockyard to deploy
        env:
          IMAGE: \${{ steps.image.outputs.name }}
          HOOK_URL: \${{ secrets.DOCKYARD_HOOK_URL }}
          HOOK_SECRET: \${{ secrets.DOCKYARD_HOOK_SECRET }}
          DIGEST: \${{ steps.build.outputs.digest }}
        run: |
          BODY=$(jq -nc --arg image "$IMAGE" --arg digest "$DIGEST" --arg commit "$GITHUB_SHA" \\
            '{image: $image, digest: $digest, commit: $commit}')
          TS=$(date +%s)
          SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$HOOK_SECRET" -hex | sed 's/^.* //')
          curl -fsS -X POST "$HOOK_URL" \\
            -H "Content-Type: application/json" \\
            -H "X-Dockyard-Timestamp: $TS" \\
            -H "X-Dockyard-Signature: sha256=$SIG" \\
            -d "$BODY"
`
}

const registries = [
  { key: 'ghcr', label: 'GitHub Container Registry' },
  { key: 'dockerhub', label: 'Docker Hub' },
] as const

export default function Webhook({ app }: { app: AppDetail }) {
  const { data: hook, error, setData } = useResource(() => api.getHook(app.id), [app.id])
  const { data: meta } = useResource(api.meta, [])
  const [revealed, setRevealed] = useState(false)
  const [rotateError, setRotateError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [registry, setRegistry] = useState<'ghcr' | 'dockerhub'>(app.image?.startsWith('ghcr.io/') ? 'ghcr' : 'dockerhub')

  if (!hook) return <ErrorNote error={error} />
  const imageHint = (app.image ?? 'yourname/app').replace(/[@:].*$/, '')
  const workflowText = registry === 'ghcr' ? ghcrWorkflow() : workflow(imageHint)

  async function rotate() {
    if (!confirm('Rotate the secret? CI will fail to deploy until you update DOCKYARD_HOOK_SECRET in GitHub.')) return
    setBusy(true)
    setRotateError(null)
    try {
      setData(await api.rotateHook(app.id))
      setRevealed(true)
    } catch (err) {
      setRotateError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {meta && !meta.publicAccess && (
        <div role="note" className="rounded-md border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
          GitHub cannot reach this Dockyard yet, because it has no public address. Deploy hooks start working once you set up
          public access under <Link to="/settings" className="text-accent hover:underline">Settings</Link>.
        </div>
      )}
      <p className="max-w-2xl text-ink-soft">
        After CI pushes a new image, it calls this URL and Dockyard deploys that exact image. Requests must be signed
        with the secret, so nobody else can trigger a deploy.
      </p>

      <Card className="p-5">
        <dl className="space-y-5">
          <div>
            <dt className="mb-1.5 font-medium">Hook URL</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-rule bg-paper px-3 py-1.5 font-mono text-[13px] break-all">{hook.url}</code>
              <CopyButton value={hook.url} />
            </dd>
          </div>
          <div>
            <dt className="mb-1.5 font-medium">Signing secret</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-rule bg-paper px-3 py-1.5 font-mono text-[13px] break-all">
                {revealed ? hook.secret : `${hook.secret.slice(0, 8)}${'•'.repeat(24)}`}
              </code>
              <Button size="sm" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Show'}</Button>
              <CopyButton value={hook.secret} />
              <Button variant="quiet" size="sm" busy={busy} onClick={rotate}>Rotate</Button>
            </dd>
          </div>
        </dl>
      </Card>
      <ErrorNote error={rotateError} />

      <Section title="Set up GitHub Actions" aside={<CopyButton value={workflowText} label="Copy workflow" />}>
        <div className="mb-4 inline-flex rounded-md border border-rule bg-paper p-0.5">
          {registries.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={registry === r.key}
              onClick={() => setRegistry(r.key)}
              className={cx(
                'rounded px-3.5 py-1.5 text-sm font-medium transition-colors',
                registry === r.key ? 'bg-panel text-ink shadow-xs' : 'text-ink-soft hover:text-ink',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        {registry === 'ghcr' ? (
          <ol className="mb-5 list-decimal space-y-1.5 pl-5">
            <li>
              In your app's GitHub repo, add these secrets under Settings, Secrets and variables, Actions:
              <span className="font-mono text-[13px]"> DOCKYARD_HOOK_URL</span> and
              <span className="font-mono text-[13px]"> DOCKYARD_HOOK_SECRET</span>. No registry password is needed; the workflow uses its own GitHub token.
            </li>
            <li>Save this file as <span className="font-mono text-[13px]">.github/workflows/deploy.yml</span>. The image is published as <span className="font-mono text-[13px]">ghcr.io/&lt;owner&gt;/&lt;repo&gt;</span>.</li>
            <li>
              If the package is private, add GitHub credentials under <Link to="/settings" className="text-accent hover:underline">Settings</Link>,
              Registry credentials, so Dockyard can pull the image.
            </li>
            <li>Push to main. The new deployment shows up under Deployments.</li>
          </ol>
        ) : (
          <ol className="mb-5 list-decimal space-y-1.5 pl-5">
            <li>
              In your app's GitHub repo, add these secrets under Settings, Secrets and variables, Actions:
              <span className="font-mono text-[13px]"> DOCKERHUB_USERNAME</span>,
              <span className="font-mono text-[13px]"> DOCKERHUB_TOKEN</span>,
              <span className="font-mono text-[13px]"> DOCKYARD_HOOK_URL</span> and
              <span className="font-mono text-[13px]"> DOCKYARD_HOOK_SECRET</span>.
            </li>
            <li>Save this file as <span className="font-mono text-[13px]">.github/workflows/deploy.yml</span> and check that IMAGE matches your Docker Hub repository.</li>
            <li>Push to main. The new deployment shows up under Deployments.</li>
          </ol>
        )}
        <pre className="overflow-x-auto rounded-lg scheme-dark bg-console px-4 py-3 font-mono text-xs leading-relaxed text-console-text">
          {workflowText}
        </pre>
      </Section>
    </div>
  )
}
