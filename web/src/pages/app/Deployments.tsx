import { useState } from 'react'
import { api, type AppDetail, type Deployment } from '../../api'
import { Button, Card, DeployStatus, ErrorNote } from '../../components/ui'
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
                    <span className="truncate font-mono text-xs">
                      {shortImage(d.image)}
                      {d.commitSha && <span className="ml-2 text-ink-soft">commit {d.commitSha.slice(0, 7)}</span>}
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
                {open && <DeploymentLog id={d.id} live={d.status === 'queued' || d.status === 'running'} />}
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}

function DeploymentLog({ id, live }: { id: string; live: boolean }) {
  const { data } = useResource(() => api.deployment(id), [id, live], live ? 1500 : false)
  return (
    <pre className="mx-4 mb-4 max-h-96 overflow-auto rounded-md bg-console px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-console-text">
      {data?.log || 'Waiting for output…'}
    </pre>
  )
}
