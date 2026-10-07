import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Button, ErrorNote, Field, TextInput } from './ui'
import { IconCheck, IconExternalLink } from './Icons'
import { timeAgo, useResource } from '../lib'

// Opens GitHub's fine-grained token form. The repository list and the Secrets permission
// cannot be preselected by URL, so the hint below spells them out.
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/** Settings card: the optional GitHub token that lets Dockyard store deploy hook secrets in repositories. */
export default function GithubAutomation() {
  const { data: status, error, setData } = useResource(api.github, [])
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [editing, setEditing] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSaveError(null)
    setSaved(false)
    try {
      setData(await api.saveGithub(token))
      setToken('')
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setSaveError(err)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setSaveError(null)
    try {
      setData(await api.removeGithub())
    } catch (err) {
      setSaveError(err)
    } finally {
      setRemoving(false)
    }
  }

  const showForm = !status?.configured || editing

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-soft leading-relaxed">
        With a GitHub token, <span className="font-mono">dockyard deploy</span> adds the deploy hook secret to the app's repository for
        you, so neither you nor an agent has to paste <span className="font-mono">DOCKYARD_HOOK_SECRET</span> by hand or sign in to the
        GitHub CLI. Dockyard only writes a secret that is missing;{' '}
        <span className="font-mono">dockyard deploy --reset-secret</span> overwrites one.
      </p>

      <ErrorNote error={error} />

      {status?.configured && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-paper/50 px-4 py-3">
          <div className="min-w-0 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-ink">
              <span className="size-1.5 rounded-full bg-starboard" aria-hidden="true" />
              Connected as @{status.login}
            </div>
            <div className="mt-0.5 text-ink-soft">
              {status.updatedAt ? `Token saved ${timeAgo(status.updatedAt)}.` : 'Token saved.'} The token itself is never shown again.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {removing ? (
              <>
                <span className="text-xs text-ink-soft">Remove the token?</span>
                <Button size="sm" variant="danger" className="text-xs" onClick={remove}>
                  Remove
                </Button>
                <Button size="sm" variant="quiet" className="text-xs" onClick={() => setRemoving(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <>
                {!editing && (
                  <Button size="sm" className="text-xs" onClick={() => setEditing(true)}>
                    Replace token
                  </Button>
                )}
                <Button size="sm" variant="quiet" className="text-xs text-port hover:bg-port/10" onClick={() => setRemoving(true)}>
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={save} className="space-y-4">
          <Field label="GitHub token">
            <TextInput
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="new-password"
              placeholder="github_pat_•••• or ghp_••••"
              required
            />
          </Field>
          <p className="text-xs text-ink-soft">
            Use a fine-grained token limited to the repositories you deploy from, with the repository permission{' '}
            <span className="font-semibold text-ink">Secrets: Read and write</span>. Nothing else is needed. A classic token works too but
            needs the much broader <span className="font-mono">repo</span> scope.{' '}
            <a
              href={TOKEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              Create a GitHub token
              <IconExternalLink className="size-3" />
            </a>
          </p>

          <ErrorNote error={saveError} />

          <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
            <Button type="submit" variant="primary" busy={busy} className="text-xs">
              Verify & Save Token
            </Button>
            {editing && (
              <Button type="button" variant="quiet" className="text-xs" onClick={() => { setEditing(false); setToken(''); setSaveError(null) }}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {!showForm && <ErrorNote error={saveError} />}

      {saved && (
        <span role="status" className="flex items-center gap-1.5 text-xs font-semibold text-starboard">
          <IconCheck className="size-3.5" />
          Token verified and saved.
        </span>
      )}
    </div>
  )
}
