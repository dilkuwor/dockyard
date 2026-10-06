import { useEffect, useState } from 'react'
import { api, type AppDetail, type EnvVar } from '../../api'
import { Button, Card, ErrorNote, TextInput } from '../../components/ui'
import { IconPlus } from '../../components/Icons'

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

  function toggleAllReveal() {
    if (revealed.size === vars?.length) {
      setRevealed(new Set())
    } else {
      setRevealed(new Set(vars?.map((_, i) => i)))
    }
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

  const allRevealed = vars.length > 0 && revealed.size === vars.length

  return (
    <Card className="max-w-4xl space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Environment Variables</h2>
          <p className="text-xs text-ink-soft mt-0.5">
            Encrypted at rest and injected into the <span className="font-medium text-ink">{app.primaryService}</span> service.
          </p>
        </div>
        {vars.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={toggleAllReveal}
            className="text-xs"
          >
            {allRevealed ? 'Hide all values' : 'Show all values'}
          </Button>
        )}
      </div>

      <div className="space-y-2.5">
        {vars.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.6fr_auto] gap-2 items-center">
            <TextInput
              aria-label="Name"
              placeholder="VARIABLE_NAME"
              value={v.key}
              onChange={(e) => update(i, { key: e.target.value })}
              className="font-mono text-xs uppercase"
            />
            <div className="flex">
              <TextInput
                aria-label="Value"
                placeholder="value"
                type={revealed.has(i) ? 'text' : 'password'}
                value={v.value}
                onChange={(e) => update(i, { value: e.target.value })}
                className="rounded-r-none font-mono text-xs"
              />
              <button
                type="button"
                onClick={() =>
                  setRevealed((s) => {
                    const n = new Set(s)
                    if (n.has(i)) n.delete(i)
                    else n.add(i)
                    return n
                  })
                }
                className="rounded-r-md border border-l-0 border-rule bg-paper px-3 text-xs font-medium text-ink-soft hover:text-ink transition-colors"
              >
                {revealed.has(i) ? 'Hide' : 'Show'}
              </button>
            </div>
            <Button
              variant="quiet"
              size="sm"
              aria-label={`Remove ${v.key || 'variable'}`}
              onClick={() => setVars(vars.filter((_, j) => j !== i))}
              className="text-xs text-ink-soft hover:text-port"
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setVars([...vars, { key: '', value: '' }])}
          className="gap-1.5 text-xs"
        >
          <IconPlus className="size-3.5" />
          <span>Add variable</span>
        </Button>
      </div>

      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
        <Button
          variant="primary"
          busy={busy === 'redeploy'}
          disabled={Boolean(busy)}
          onClick={() => save(true)}
        >
          Save and Redeploy
        </Button>
        <Button
          busy={busy === 'save'}
          disabled={Boolean(busy)}
          onClick={() => save(false)}
        >
          Save for next deploy
        </Button>
        {saved && (
          <span role="status" className="text-xs font-semibold text-starboard ml-1">
            ✓ {saved}
          </span>
        )}
      </div>
    </Card>
  )
}
