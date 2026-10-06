import { useEffect, useState } from 'react'
import { api, type AppDetail, type EnvVar } from '../../api'
import { Button, ErrorNote, TextInput } from '../../components/ui'

export default function Environment({ app }: { app: AppDetail }) {
  const [vars, setVars] = useState<EnvVar[] | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    api.getEnv(app.id).then((r) => setVars(r.vars.length ? r.vars : [{ key: '', value: '' }]), setError)
  }, [app.id])

  if (!vars) return <ErrorNote error={error} />

  const update = (i: number, patch: Partial<EnvVar>) => {
    setSaved('')
    setVars(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  }

  async function save(redeploy: boolean) {
    setBusy(redeploy ? 'redeploy' : 'save')
    setError(null)
    try {
      const res = await api.setEnv(app.id, vars!)
      setVars(res.vars.length ? res.vars : [{ key: '', value: '' }])
      if (redeploy) await api.deploy(app.id)
      setSaved(redeploy ? 'Saved. Redeploy started.' : 'Saved. Changes apply on the next deploy.')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-ink-soft">
        Variables are encrypted at rest and passed to the <span className="font-semibold text-ink">{app.primaryService}</span> service.
        They take effect on the next deploy.
      </p>
      <div className="space-y-2">
        {vars.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
            <TextInput aria-label="Name" placeholder="NAME" value={v.key} onChange={(e) => update(i, { key: e.target.value })} className="font-mono text-sm" />
            <div className="flex">
              <TextInput
                aria-label="Value"
                placeholder="value"
                type={revealed.has(i) ? 'text' : 'password'}
                value={v.value}
                onChange={(e) => update(i, { value: e.target.value })}
                className="rounded-r-none font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setRevealed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                className="rounded-r-[3px] border border-l-0 border-rule bg-panel px-3 text-sm font-semibold text-ink-soft hover:text-ink"
              >
                {revealed.has(i) ? 'Hide' : 'Show'}
              </button>
            </div>
            <Button variant="quiet" aria-label={`Remove ${v.key || 'variable'}`} onClick={() => setVars(vars.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Button variant="quiet" onClick={() => setVars([...vars, { key: '', value: '' }])}>Add variable</Button>
      <ErrorNote error={error} />
      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-5">
        <Button variant="primary" busy={busy === 'redeploy'} disabled={!!busy} onClick={() => save(true)}>Save and redeploy</Button>
        <Button busy={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>Save</Button>
        {saved && <span role="status" className="text-[15px] font-semibold text-starboard">{saved}</span>}
      </div>
    </div>
  )
}
