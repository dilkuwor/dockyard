import { useState } from 'react'
import { api, type AppDetail, type Deployment } from '../../api'
import { Button, Card, DeployStatus, ErrorNote } from '../../components/ui'
import LineDiff from '../../components/LineDiff'
import { duration, shortImage, timeAgo, useResource } from '../../lib'

const triggers: Record<Deployment['trigger'], string> = {
  create: 'First deploy',
  manual: 'Manual',
  webhook: 'Deploy hook',
  rollback: 'Rollback',
}

export default function Deployments({ app, onChange }: { app: AppDetail; onChange: () => void }) {
  const { data: list, error, reload } = useResource(() => api.deployments(app.id), [app.id], 2500)
  const [openId, setOpenId] = useState<string | null>(null)
  const [rollbackError, setRollbackError] = useState<unknown>(null)
  const active = list?.some((d) => d.status === 'queued' || d.status === 'running')
  const openFirst = openId ?? (active ? list?.find((d) => d.status !== 'succeeded')?.id ?? null : null)

  async function rollback(d: Deployment) {
    setRollbackError(null)
    try {
      const created = await api.rollback(d.id)
      setOpenId(created.id)
      await reload()
      onChange()
    } catch (err) {
      setRollbackError(err)
    }
  }

  if (error && !list) return <ErrorNote error={error} />
  if (!list) return null
  if (list.length === 0) return <p className="text-ink-soft">No deployments yet.</p>

  return (
    <div className="space-y-4">
      <ErrorNote error={rollbackError} />
      <Card className="overflow-hidden">
        <ol className="divide-y divide-rule">
          {list.map((d) => {
            const open = openFirst === d.id
            const isCurrent = d.id === app.currentDeploymentId
            return (
              <li key={d.id}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? '' : d.id)}
                    aria-expanded={open}
                    className="grid min-w-0 flex-1 items-center gap-x-6 gap-y-1 text-left sm:grid-cols-[7rem_6.5rem_1fr_9.5rem]"
                  >
                    <span>
                      <DeployStatus status={d.status} superseded={d.status === 'succeeded' && !isCurrent} />
                    </span>
                    <span className="text-[13px] text-ink-soft">{triggers[d.trigger]}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">
                        {shortImage(d.image)}
                        {d.commitSha && <span className="ml-2 text-ink-soft">commit {d.commitSha.slice(0, 7)}</span>}
                        {d.branch && <span className="ml-2 text-ink-soft">on {d.branch}</span>}
                      </span>
                      {d.commitMessage && <span className="block truncate text-xs text-ink-soft" title={d.commitMessage}>{d.commitMessage.split('\n')[0]}</span>}
                    </span>
                    <span className="text-[13px] text-ink-soft">
                      {timeAgo(d.createdAt)}
                      {d.finishedAt && `, took ${duration(d.createdAt, d.finishedAt)}`}
                    </span>
                  </button>
                  <div className="flex justify-end sm:w-34">
                    {d.status === 'succeeded' && !isCurrent && (
                      <Button size="sm" onClick={() => rollback(d)}>Roll back to this</Button>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="mx-4 mb-4 space-y-3">
                    <DeploymentDetails d={d} />
                    <DeploymentLog id={d.id} live={d.status === 'queued' || d.status === 'running'} />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}

/** What this deployment carried and what changed since the previous one. */
function DeploymentDetails({ d }: { d: Deployment }) {
  const { data: diff } = useResource(() => api.deploymentDiff(d.id), [d.id])
  const [showCompose, setShowCompose] = useState(false)
  const envChanges = diff ? diff.env.added.length + diff.env.removed.length + diff.env.changed.length : 0
  const imageChanged = diff ? diff.image.before !== diff.image.after : false
  const nothingChanged = diff && diff.previous && !diff.compose.changed && envChanges === 0 && !imageChanged

  return (
    <div className="rounded-md border border-rule bg-paper/60 px-4 py-3 text-xs">
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[7rem_1fr]">
        {d.image && (
          <>
            <dt className="text-ink-soft">Image</dt>
            <dd className="font-mono break-all text-ink">{d.image}</dd>
          </>
        )}
        {d.commitSha && (
          <>
            <dt className="text-ink-soft">Commit</dt>
            <dd className="text-ink">
              <span className="font-mono">{d.commitSha}</span>
              {d.branch && <span className="ml-2 text-ink-soft">on {d.branch}</span>}
              {d.commitMessage && <span className="mt-0.5 block whitespace-pre-wrap text-ink-soft">{d.commitMessage}</span>}
            </dd>
          </>
        )}
        <dt className="text-ink-soft">Changes</dt>
        <dd className="text-ink">
          {!diff ? (
            <span className="text-ink-soft">Comparing…</span>
          ) : !diff.previous ? (
            <span className="text-ink-soft">First deployment of this app.</span>
          ) : nothingChanged ? (
            <span className="text-ink-soft">Same image, compose file and variables as the deployment before it.</span>
          ) : (
            <ul className="space-y-1">
              {imageChanged && (
                <li>
                  Image changed from <span className="font-mono">{shortImage(diff.image.before)}</span> to{' '}
                  <span className="font-mono">{shortImage(diff.image.after)}</span>
                </li>
              )}
              {envChanges > 0 && (
                <li>
                  Variables:
                  {diff.env.added.length > 0 && <span className="ml-1 text-starboard">added {diff.env.added.join(', ')}</span>}
                  {diff.env.changed.length > 0 && <span className="ml-1 text-accent">changed {diff.env.changed.join(', ')}</span>}
                  {diff.env.removed.length > 0 && <span className="ml-1 text-port">removed {diff.env.removed.join(', ')}</span>}
                </li>
              )}
              {diff.compose.changed && (
                <li>
                  Compose file changed.{' '}
                  <button type="button" onClick={() => setShowCompose((v) => !v)} className="font-medium text-accent hover:underline">
                    {showCompose ? 'Hide diff' : 'Show diff'}
                  </button>
                </li>
              )}
            </ul>
          )}
        </dd>
      </dl>
      {showCompose && diff && <div className="mt-3"><LineDiff before={diff.compose.before} after={diff.compose.after} /></div>}
    </div>
  )
}

function DeploymentLog({ id, live }: { id: string; live: boolean }) {
  const { data } = useResource(() => api.deployment(id), [id, live], live ? 1500 : false)
  return (
    <pre className="max-h-96 overflow-auto rounded-md scheme-dark bg-console px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-console-text">
      {data?.log || 'Waiting for output…'}
    </pre>
  )
}
