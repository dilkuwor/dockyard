import { useState } from 'react'
import { api, type AppDetail, type Deployment } from '../../api'
import { Button, DeployStatus, ErrorNote } from '../../components/ui'
import { cx, duration, shortImage, timeAgo, useResource } from '../../lib'

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
      <ol className="bg-panel">
        {list.map((d) => {
          const open = openFirst === d.id
          const isCurrent = d.id === app.currentDeploymentId
          return (
            <li key={d.id} className={cx('border-b border-rule last:border-b-0', isCurrent && 'border-l-4 border-l-starboard')}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? '' : d.id)}
                  aria-expanded={open}
                  className="grid min-w-0 flex-1 gap-x-6 gap-y-1 text-left sm:grid-cols-[7rem_7rem_1fr_7rem]"
                >
                  <DeployStatus status={d.status} superseded={d.status === 'succeeded' && !isCurrent} />
                  <span className="text-ink-soft">{triggers[d.trigger]}</span>
                  <span className="truncate font-mono text-[13px]">
                    {shortImage(d.image)}
                    {d.commitSha && <span className="ml-2 text-ink-soft">commit {d.commitSha.slice(0, 7)}</span>}
                  </span>
                  <span className="text-sm text-ink-soft">
                    {timeAgo(d.createdAt)}
                    {d.finishedAt && `, took ${duration(d.createdAt, d.finishedAt)}`}
                  </span>
                </button>
                {d.status === 'succeeded' && !isCurrent && (
                  <Button className="px-2.5 py-1 text-sm" onClick={() => rollback(d)}>Roll back to this</Button>
                )}
              </div>
              {open && <DeploymentLog id={d.id} live={d.status === 'queued' || d.status === 'running'} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function DeploymentLog({ id, live }: { id: string; live: boolean }) {
  const { data } = useResource(() => api.deployment(id), [id, live], live ? 1500 : false)
  return (
    <pre className="max-h-96 overflow-auto bg-console px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-console-text">
      {data?.log || 'Waiting for output…'}
    </pre>
  )
}
