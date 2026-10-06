import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { Card, CopyButton, Section } from '../components/ui'
import { useResource } from '../lib'

function Command({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg scheme-dark bg-console py-2 pr-2 pl-4">
      <pre className="min-w-0 flex-1 overflow-x-auto scheme-dark py-1.5 font-mono text-xs leading-relaxed text-console-text">{children}</pre>
      <CopyButton value={children} />
    </div>
  )
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <h3 className="font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  )
}

const mono = 'font-mono text-[13px] text-ink'

const commands: [string, string][] = [
  ['dockyard deploy --port 3000', 'Register the app if it is new, add the GitHub workflow, push, and wait until it is live. Add --name and --address the first time if you want to choose them.'],
  ['dockyard status', "Show the app's address, containers and last deployment."],
  ['dockyard env KEY=VALUE', 'Set environment variables. With no arguments it lists their names.'],
  ['dockyard redeploy', 'Deploy the current image again, for example after changing variables.'],
  ['dockyard logs 200', "Print the app's recent output."],
  ['dockyard guide', "Print this server's deployment guide, written for AI agents."],
  ['dockyard help', 'List every command and option.'],
]

const problems: [string, ReactNode][] = [
  ['command not found: dockyard', <>The folder <span className={mono}>~/.local/bin</span> is not on your PATH. Run the PATH command in step 3 and open a new terminal.</>],
  ['DOCKYARD_URL is not set', <>The settings file is missing. Repeat step 1.</>],
  ['the server did not accept DOCKYARD_TOKEN', <>The token was revoked or mistyped. Create a new one on the <Link to="/agents" className="text-accent hover:underline">Agents</Link> page and repeat step 1.</>],
  ['missing required command: jq', <>Install the tools listed under "Before you start".</>],
  ['run this inside the app\'s git repository', <>Change into your app's folder first. It must be a git repository with a GitHub remote named origin.</>],
  ['no Dockerfile at the repository root', <>Dockyard runs container images, so the app needs a Dockerfile. An AI agent can write one for you.</>],
  ['It waits and then times out', <>GitHub did not reach Dockyard. Open the repository's Actions tab on GitHub: a failed build, or a missing or wrong <span className={mono}>DOCKYARD_HOOK_SECRET</span>, shows there.</>],
]

export default function HelpPage() {
  const { data: meta } = useResource(api.meta, [])
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

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Install the dockyard command</h1>
        <p className="mt-1 text-ink-soft">
          <span className={mono}>dockyard</span> is a small command you run in an app's folder on your own computer to put that app
          live here. It works on macOS and Linux; on Windows, use it inside WSL.
        </p>
      </div>

      <Section title="Before you start">
        <Card className="space-y-3 p-5">
          <p>
            Your computer needs <span className={mono}>git</span>, <span className={mono}>curl</span> and <span className={mono}>jq</span>.
            Most machines already have the first two.
          </p>
          <Command>{`brew install jq                  # macOS
sudo apt install -y git curl jq  # Ubuntu or Debian`}</Command>
          <p>
            You also need an access token. Create one on the <Link to="/agents" className="text-accent hover:underline">Agents</Link> page
            and copy it; it is shown only once.
          </p>
        </Card>
      </Section>

      <Section title="Install">
        <ol className="space-y-7">
          <Step number={1} title="Save this server's address and your token">
            <p className="text-ink-soft">
              Replace <span className={mono}>PASTE_YOUR_TOKEN_HERE</span> with your token before running it. The file is readable only by you.
            </p>
            <Command>{saveSettings}</Command>
          </Step>
          <Step number={2} title="Download the command">
            <p className="text-ink-soft">It is downloaded from this server, so it always matches this version of Dockyard.</p>
            <Command>{download}</Command>
          </Step>
          <Step number={3} title="Check that it works">
            <Command>dockyard help</Command>
            <p className="text-ink-soft">
              If the terminal says <span className={mono}>command not found</span>, add the folder to your PATH, then open a new terminal
              window and try again:
            </p>
            <Command>{addToPath}</Command>
          </Step>
        </ol>
      </Section>

      <Section title="Deploy your first app">
        <div className="space-y-3">
          <p className="text-ink-soft">
            The app needs a <span className={mono}>Dockerfile</span> and a GitHub repository.
            {meta?.globalHook ? (
              <>
                {' '}Add the global hook secret from the <Link to="/agents" className="text-accent hover:underline">Agents</Link> page to that
                repository as the Actions secret <span className={mono}>DOCKYARD_HOOK_SECRET</span>, then run:
              </>
            ) : (
              <>
                {' '}The global deploy hook is off, so the command stores each app's own secret for you, which needs the GitHub CLI
                (<span className={mono}>gh auth login</span>). Then run:
              </>
            )}
          </p>
          <Command>{firstDeploy}</Command>
          <p className="text-ink-soft">
            <span className={mono}>--port</span> is the port the app listens on inside its container. <span className={mono}>--address</span> is
            optional and makes the app available at <span className={mono}>my-app.{meta?.baseDomain ?? 'yourdomain'}</span>. After the first
            deploy, every push to GitHub redeploys the app.
          </p>
        </div>
      </Section>

      <Section title="Commands">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-rule">
            {commands.map(([command, what]) => (
              <li key={command} className="grid gap-1 px-5 py-3 sm:grid-cols-[15rem_1fr] sm:gap-4">
                <code className="font-mono text-[13px]">{command}</code>
                <span className="text-ink-soft">{what}</span>
              </li>
            ))}
          </ul>
        </Card>
        <p className="mt-3 text-[13px] text-ink-soft">Run them inside the app's folder. Each one finds the app from the folder's GitHub repository.</p>
      </Section>

      <Section title="If something goes wrong">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-rule">
            {problems.map(([message, fix]) => (
              <li key={message} className="px-5 py-3">
                <p className="font-mono text-[13px]">{message}</p>
                <p className="mt-1 text-ink-soft">{fix}</p>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="Update or remove">
        <div className="space-y-3">
          <p className="text-ink-soft">
            To update after Dockyard itself is upgraded, run step 2 again. To remove the command from this computer, delete its two files
            and revoke the token on the <Link to="/agents" className="text-accent hover:underline">Agents</Link> page:
          </p>
          <Command>{remove}</Command>
        </div>
      </Section>
    </div>
  )
}
