import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { Card, CopyButton, TextInput } from '../components/ui'
import { IconTerminal, IconSearch } from '../components/Icons'
import { useResource } from '../lib'

function Command({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg scheme-dark bg-console py-2 pr-2 pl-4 border border-slate-800">
      <pre className="min-w-0 flex-1 overflow-x-auto scheme-dark py-1 font-mono text-xs leading-relaxed text-console-text">{children}</pre>
      <CopyButton value={children} />
    </div>
  )
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-paper">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <h3 className="font-semibold text-sm text-ink">{title}</h3>
        {children}
      </div>
    </li>
  )
}

const mono = 'font-mono text-xs text-ink font-semibold'

const commands: [string, string][] = [
  ['dockyard deploy --port 3000', 'Register the app if new, add GitHub workflow, push, and monitor until live. Add --name and --address if choosing explicitly.'],
  ['dockyard status', "Display current address, running container states, and latest deployment status."],
  ['dockyard env KEY=VALUE', 'Set environment variables. With no arguments, it lists all defined variable keys.'],
  ['dockyard redeploy', 'Redeploy the current container image, such as after updating environment variables.'],
  ['dockyard logs 200', "Stream or print the application's recent stdout and stderr lines."],
  ['dockyard guide', "Print server deployment guide written specifically for autonomous AI agents."],
  ['dockyard help', 'Print complete command usage, options, and flags.'],
]

const problems: [string, ReactNode][] = [
  ['command not found: dockyard', <>The folder <span className={mono}>~/.local/bin</span> is not on your PATH. Run the PATH command in step 3 and open a new terminal session.</>],
  ['DOCKYARD_URL is not set', <>The local configuration file is missing. Repeat step 1 to save config.</>],
  ['the server did not accept DOCKYARD_TOKEN', <>The token was revoked or mistyped. Create a new one on the <Link to="/agents" className="text-accent hover:underline">Agent Access</Link> page and repeat step 1.</>],
  ['missing required command: jq', <>Install <span className={mono}>jq</span> using Homebrew on macOS (<code className={mono}>brew install jq</code>) or apt on Linux.</>],
  ['run this inside the app\'s git repository', <>Navigate into your application directory first. It must be an active git repository with a GitHub remote named origin.</>],
  ['no Dockerfile at the repository root', <>Dockyard runs container images, so the repository needs a Dockerfile.</>],
  ['It waits and then times out', <>GitHub could not connect to Dockyard. Inspect your repository Actions tab on GitHub to verify build status and <span className={mono}>DOCKYARD_HOOK_SECRET</span>.</>],
]

export default function HelpPage() {
  const { data: meta } = useResource(api.meta, [])
  const [cmdFilter, setCmdFilter] = useState('')
  const origin = window.location.origin

  const saveSettings = `mkdir -p ~/.config/dockyard
printf 'DOCKYARD_URL=%s\\nDOCKYARD_TOKEN=%s\\n' '${origin}' 'PASTE_YOUR_TOKEN_HERE' > ~/.config/dockyard/config
chmod 600 ~/.config/dockyard/config`
  const download = `mkdir -p ~/.local/bin
curl -fsS -H "Authorization: Bearer $(grep '^DOCKYARD_TOKEN=' ~/.config/dockyard/config | cut -d= -f2-)" ${origin}/api/agent/cli -o ~/.local/bin/dockyard
chmod +x ~/.local/bin/dockyard`
  const addToPath = `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc   # on Linux use ~/.bashrc`
  const firstDeploy = `cd path/to/your-app
dockyard deploy --name "My App" --port 3000 --address my-app`
  const remove = `rm -f ~/.local/bin/dockyard ~/.config/dockyard/config`

  const filteredCommands = commands.filter(
    ([cmd, desc]) =>
      cmd.toLowerCase().includes(cmdFilter.toLowerCase()) ||
      desc.toLowerCase().includes(cmdFilter.toLowerCase())
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">CLI Tools & Deployment Documentation</h1>
        <p className="mt-1 text-sm text-ink-soft">
          <span className={mono}>dockyard</span> is a lightweight CLI you run on your development computer or inside an AI agent session
          to ship and manage apps directly from git repositories.
        </p>
      </div>

      {/* Installation Steps */}
      <Card className="p-6 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-rule pb-4">
          <div className="rounded-md bg-accent/10 p-2 text-accent">
            <IconTerminal className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">CLI Installation (macOS & Linux)</h2>
            <p className="text-xs text-ink-soft">Requires curl and jq installed locally.</p>
          </div>
        </div>

        <ol className="space-y-6">
          <Step number={1} title="Save Server URL and Token">
            <p className="text-xs text-ink-soft">
              Generate an access token on the <Link to="/agents" className="text-accent hover:underline">Agent Access</Link> page, then run:
            </p>
            <Command>{saveSettings}</Command>
          </Step>

          <Step number={2} title="Download Dockyard Executable">
            <p className="text-xs text-ink-soft">
              Downloads the CLI binary directly from this Dockyard instance:
            </p>
            <Command>{download}</Command>
          </Step>

          <Step number={3} title="Verify Installation & PATH">
            <Command>dockyard help</Command>
            <p className="text-xs text-ink-soft">
              If the terminal says <span className={mono}>command not found</span>, ensure <span className={mono}>~/.local/bin</span> is on your PATH:
            </p>
            <Command>{addToPath}</Command>
          </Step>
        </ol>
      </Card>

      {/* Deploying from CLI */}
      <Card className="p-6 space-y-4">
        <h2 className="text-base font-semibold text-ink">Deploying Your First App from CLI</h2>
        <p className="text-xs text-ink-soft leading-relaxed">
          Navigate into your application directory containing a <span className={mono}>Dockerfile</span> and connected to GitHub.
          {meta?.github ? (
            <> Dockyard stores the <span className={mono}>DOCKYARD_HOOK_SECRET</span> repository secret for you with its GitHub token, so just run:</>
          ) : meta?.globalHook ? (
            <> Ensure your repository Actions secret contains <span className={mono}>DOCKYARD_HOOK_SECRET</span>, then run:</>
          ) : (
            <> Dockyard configures individual repository hooks automatically with GitHub CLI:</>
          )}
        </p>
        <Command>{firstDeploy}</Command>
      </Card>

      {/* Command Reference */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4">
          <div>
            <h2 className="text-base font-semibold text-ink">CLI Command Reference</h2>
            <p className="text-xs text-ink-soft">Run these commands inside any git repository linked to Dockyard.</p>
          </div>
          <div className="relative w-full sm:w-60">
            <IconSearch className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-ink-soft/70" />
            <TextInput
              value={cmdFilter}
              onChange={(e) => setCmdFilter(e.target.value)}
              placeholder="Search commands…"
              className="pl-8 text-xs py-1.5"
            />
          </div>
        </div>

        <div className="rounded-lg border border-rule overflow-hidden">
          <ul className="divide-y divide-rule">
            {filteredCommands.map(([command, what]) => (
              <li key={command} className="grid gap-1 px-4 py-3 sm:grid-cols-[16rem_1fr] sm:gap-4 hover:bg-paper/40 transition-colors">
                <code className="font-mono text-xs font-semibold text-ink break-all">{command}</code>
                <span className="text-xs text-ink-soft">{what}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Troubleshooting */}
      <Card className="p-6 space-y-4">
        <h2 className="text-base font-semibold text-ink">Troubleshooting & Diagnostics</h2>
        <div className="rounded-lg border border-rule overflow-hidden">
          <ul className="divide-y divide-rule">
            {problems.map(([message, fix]) => (
              <li key={message} className="px-4 py-3 space-y-1 hover:bg-paper/40 transition-colors">
                <p className="font-mono text-xs font-semibold text-port">{message}</p>
                <div className="text-xs text-ink-soft leading-relaxed">{fix}</div>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Uninstallation */}
      <Card className="p-6 space-y-3">
        <h2 className="text-base font-semibold text-ink">Uninstalling the CLI</h2>
        <p className="text-xs text-ink-soft">
          To remove the CLI from your local machine, delete its configuration and binary:
        </p>
        <Command>{remove}</Command>
      </Card>
    </div>
  )
}
