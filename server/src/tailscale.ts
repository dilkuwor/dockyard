import { config } from './config.js';
import { getSetting, setSetting } from './db.js';
import { lastLine, run } from './docker.js';
import { POSTGRES_CONTAINER, ensureDataNetwork, ensurePostgres } from './postgres.js';

/**
 * Remote access to the shared Postgres server over Tailscale. Cloudflare's proxy and tunnel carry
 * web traffic only, so a database client cannot reach the server through them. Instead Dockyard
 * runs a Tailscale node on the data network that forwards port 5432 of its tailnet address to the
 * server. Nothing is opened on the machine or the router, and only devices on the user's tailnet
 * can connect.
 *
 * Joining needs no key: the node asks Tailscale for a login link, the dashboard shows it, and the
 * user signs in there with their usual identity provider (Google, Microsoft, GitHub, Apple, Okta…).
 * An auth key can be given instead, for machines nobody signs in from.
 */
export const TAILSCALE_CONTAINER = 'dockyard-tailscale';
const IMAGE = 'tailscale/tailscale:stable';
// Holds the node's identity, so a restart or a recreation stays the same machine on the tailnet.
const STATE_VOLUME = 'dockyard-tailscale-state';
const STATE_DIR = '/var/lib/tailscale';
const SERVE_CONFIG = `${STATE_DIR}/serve.json`;
// The machine name on the tailnet; Tailscale adds a suffix when the name is taken.
const HOSTNAME = 'dockyard-postgres';
const ENABLED_SETTING = 'shared_postgres_remote';

export type RemoteState = 'off' | 'starting' | 'needs-login' | 'needs-approval' | 'connected' | 'stopped' | 'error';

export interface RemoteAccess {
  enabled: boolean;
  state: RemoteState;
  /** The MagicDNS name to connect to, without the trailing dot. */
  dnsName: string | null;
  ips: string[];
  tailnet: string | null;
  /** When the node's key expires and it drops off the tailnet, unless expiry is turned off for it. */
  keyExpiry: string | null;
  error: string | null;
}

export const remoteEnabled = (): boolean => getSetting(ENABLED_SETTING) === '1';

interface TailscaleStatus {
  BackendState?: string;
  AuthURL?: string;
  CurrentTailnet?: { Name?: string; MagicDNSSuffix?: string } | null;
  Self?: { DNSName?: string; TailscaleIPs?: string[] | null; KeyExpiry?: string } | null;
  Health?: string[] | null;
}

async function containerState(): Promise<'running' | 'stopped' | 'missing'> {
  const res = await run(['inspect', '--format', '{{.State.Running}}', TAILSCALE_CONTAINER]);
  if (res.code !== 0) return 'missing';
  return res.stdout.trim() === 'true' ? 'running' : 'stopped';
}

async function readStatus(): Promise<TailscaleStatus | null> {
  const res = await run(['exec', TAILSCALE_CONTAINER, 'tailscale', 'status', '--json'], { timeoutMs: 10_000 });
  // While logged out the command still prints the status, but exits non-zero.
  try {
    return JSON.parse(res.stdout) as TailscaleStatus;
  } catch {
    return null;
  }
}

function describe(status: TailscaleStatus | null): Omit<RemoteAccess, 'enabled'> & { loginUrl: string | null } {
  const empty = { dnsName: null, ips: [], tailnet: null, keyExpiry: null, error: null, loginUrl: null };
  if (!status) return { ...empty, state: 'starting' };
  const backend = status.BackendState ?? '';
  if (backend === 'Running') {
    const expiry = status.Self?.KeyExpiry;
    return {
      ...empty,
      state: 'connected',
      dnsName: status.Self?.DNSName?.replace(/\.$/, '') || null,
      ips: status.Self?.TailscaleIPs ?? [],
      tailnet: status.CurrentTailnet?.Name ?? null,
      keyExpiry: expiry && !expiry.startsWith('0001-') ? expiry : null,
    };
  }
  if (backend === 'NeedsMachineAuth') return { ...empty, state: 'needs-approval', tailnet: status.CurrentTailnet?.Name ?? null };
  if (backend === 'NeedsLogin') {
    return status.AuthURL ? { ...empty, state: 'needs-login', loginUrl: status.AuthURL } : { ...empty, state: 'starting' };
  }
  return { ...empty, state: 'starting' };
}

/** Where remote access stands, with the login link. The link lets whoever opens it add this node to their tailnet, so it is for the session-only route. */
export async function remoteAccess(): Promise<RemoteAccess & { loginUrl: string | null }> {
  const enabled = remoteEnabled();
  const base = { enabled, dnsName: null, ips: [], tailnet: null, keyExpiry: null, error: null, loginUrl: null };
  const state = await containerState();
  if (state === 'missing') return { ...base, state: enabled ? 'error' : 'off', error: enabled ? 'The Tailscale container is missing. Turn remote access off and on again.' : null };
  if (state === 'stopped') return { ...base, state: 'stopped' };
  return { enabled, ...describe(await readStatus()) };
}

/** The same without the login link, for the services overview, which API tokens can read too. */
export async function remoteAccessSummary(): Promise<RemoteAccess> {
  const { loginUrl: _loginUrl, ...rest } = await remoteAccess();
  return rest;
}

async function ensureImage(): Promise<void> {
  const present = await run(['image', 'inspect', '--format', '{{.Id}}', IMAGE]);
  if (present.code === 0) return;
  const pull = await run(['pull', IMAGE], { timeoutMs: 600_000 });
  if (pull.code !== 0) throw new Error(`Could not pull ${IMAGE}: ${lastLine(pull.stderr)}`);
}

/**
 * Tells the node to forward its tailnet port 5432 to the server. The file lives in the state
 * volume, since Dockyard itself runs in a container and cannot bind-mount its own files; the
 * node applies it through its local API once it is on the tailnet, and again whenever it changes.
 */
async function writeServeConfig(): Promise<void> {
  const serve = JSON.stringify({ TCP: { '5432': { TCPForward: `${POSTGRES_CONTAINER}:5432` } } });
  const res = await run(
    ['run', '--rm', '-i', '-v', `${STATE_VOLUME}:${STATE_DIR}`, '--entrypoint', 'sh', IMAGE, '-c', `cat > ${SERVE_CONFIG}`],
    { input: serve, timeoutMs: 60_000 },
  );
  if (res.code !== 0) throw new Error(`Could not write the Tailscale serve settings: ${lastLine(res.stderr)}`);
}

async function createContainer(authKey: string | null): Promise<void> {
  await ensureImage();
  await ensureDataNetwork();
  await writeServeConfig();
  const env: Record<string, string> = {};
  if (authKey) env.TS_AUTHKEY = authKey;
  const res = await run(
    [
      'run', '-d', '--name', TAILSCALE_CONTAINER, '--restart', 'unless-stopped', '--network', config.dataNetwork,
      '--label', 'dockyard.role=tailscale',
      '-v', `${STATE_VOLUME}:${STATE_DIR}`,
      '-e', `TS_STATE_DIR=${STATE_DIR}`,
      // Userspace networking needs no extra privileges or /dev/net/tun.
      '-e', 'TS_USERSPACE=true',
      '-e', `TS_HOSTNAME=${HOSTNAME}`,
      // Log in only when the state holds no identity yet; a used one-off key must not be tried again on restart.
      '-e', 'TS_AUTH_ONCE=true',
      '-e', `TS_SERVE_CONFIG=${SERVE_CONFIG}`,
      ...(authKey ? ['-e', 'TS_AUTHKEY'] : []),
      IMAGE,
    ],
    { env, timeoutMs: 120_000 },
  );
  if (res.code !== 0) throw new Error(`Could not start Tailscale: ${lastLine(res.stderr)}`);
}

/** Waits until the node either has a login link, waits for approval, or is on the tailnet. */
async function waitSettled(timeoutMs = 45_000): Promise<RemoteAccess & { loginUrl: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let latest = await remoteAccess();
  while (Date.now() < deadline) {
    if (latest.state !== 'starting') return latest;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    latest = await remoteAccess();
  }
  if (latest.state === 'starting') {
    const logs = await run(['logs', '--tail', '40', TAILSCALE_CONTAINER]);
    const said = (logs.stdout + logs.stderr).split('\n').filter((l) => /error|invalid|failed/i.test(l)).pop();
    return { ...latest, error: said ? `Tailscale has not connected yet: ${said.trim()}` : 'Tailscale is still starting. Check again in a moment.' };
  }
  return latest;
}

/**
 * Turns remote access on: starts the server if needed and the Tailscale node next to it. Without a
 * key the result carries a login link; with one the node joins by itself. A node that already
 * joined earlier simply reconnects.
 */
export async function enableRemote(authKey: string | null): Promise<RemoteAccess & { loginUrl: string | null }> {
  if (authKey !== null && !/^tskey-[A-Za-z0-9-]+$/.test(authKey)) throw new Error('That does not look like a Tailscale auth key; they start with "tskey-".');
  await ensurePostgres();
  setSetting(ENABLED_SETTING, '1');
  const state = await containerState();
  if (state === 'missing' || authKey) {
    // A new key means signing in again, which only happens on a fresh state.
    if (authKey && state !== 'missing') await removeNode();
    await createContainer(authKey);
  } else if (state === 'stopped') {
    const start = await run(['start', TAILSCALE_CONTAINER]);
    if (start.code !== 0) throw new Error(`Could not start ${TAILSCALE_CONTAINER}: ${lastLine(start.stderr)}`);
  }
  return waitSettled();
}

/** Signs the node out of the tailnet and forgets it, so turning access on again starts with a fresh login. */
async function removeNode(): Promise<void> {
  if ((await containerState()) === 'running') {
    await run(['exec', TAILSCALE_CONTAINER, 'tailscale', 'logout'], { timeoutMs: 20_000 });
  }
  await run(['rm', '-f', TAILSCALE_CONTAINER]);
  await run(['volume', 'rm', '-f', STATE_VOLUME]);
}

export async function disableRemote(): Promise<void> {
  await removeNode();
  setSetting(ENABLED_SETTING, null);
}

/** At startup: brings a node back that should be running, for instance after the container was removed by hand. */
export async function ensureRemote(): Promise<void> {
  if (!remoteEnabled()) return;
  const state = await containerState();
  if (state === 'running') return;
  if (state === 'stopped') {
    const start = await run(['start', TAILSCALE_CONTAINER]);
    if (start.code !== 0) throw new Error(`Could not start ${TAILSCALE_CONTAINER}: ${lastLine(start.stderr)}`);
    return;
  }
  await createContainer(null);
}
