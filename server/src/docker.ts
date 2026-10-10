import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(
  args: string[],
  opts: { onLine?: (line: string) => void; input?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { env: opts.env ? { ...process.env, ...opts.env } : process.env });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : null;

    const feed = (chunk: Buffer, sink: 'out' | 'err') => {
      const text = chunk.toString();
      if (sink === 'out') stdout += text;
      else stderr += text;
      if (opts.onLine) {
        pending += text;
        const lines = pending.split(/\r?\n|\r/);
        pending = lines.pop() ?? '';
        lines.filter(Boolean).forEach(opts.onLine);
      }
    };
    child.stdout.on('data', (c) => feed(c, 'out'));
    child.stderr.on('data', (c) => feed(c, 'err'));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      opts.onLine?.(`Could not run docker: ${err.message}`);
      resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (pending && opts.onLine) opts.onLine(pending);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export const projectName = (appId: string) => `dy_${appId}`;
export const appDir = (appId: string) => path.join(config.appsDir, appId);
export const composePath = (appId: string) => path.join(appDir(appId), 'docker-compose.yml');

function composeArgs(appId: string, ...rest: string[]): string[] {
  const args = ['compose', '--ansi', 'never', '-p', projectName(appId)];
  if (fs.existsSync(composePath(appId))) args.push('-f', composePath(appId));
  return [...args, ...rest];
}

export function writeComposeFile(appId: string, content: string): void {
  fs.mkdirSync(appDir(appId), { recursive: true, mode: 0o700 });
  fs.writeFileSync(composePath(appId), content, { mode: 0o600 });
}

export function removeAppDir(appId: string): void {
  fs.rmSync(appDir(appId), { recursive: true, force: true });
}

export const compose = {
  pull: (appId: string, onLine: (l: string) => void) => run(composeArgs(appId, 'pull'), { onLine }),
  up: (appId: string, onLine: (l: string) => void) =>
    run(
      composeArgs(appId, 'up', '-d', '--remove-orphans', '--wait', '--wait-timeout', String(config.deployTimeoutSeconds)),
      { onLine },
    ),
  action: (appId: string, action: 'start' | 'stop' | 'restart') => run(composeArgs(appId, action)),
  down: (appId: string, removeVolumes: boolean) =>
    run(composeArgs(appId, 'down', '--remove-orphans', ...(removeVolumes ? ['--volumes'] : []))),
  logs: (appId: string, tail: number) =>
    run(composeArgs(appId, 'logs', '--no-color', '--timestamps', '--tail', String(tail)), { timeoutMs: 15_000 }),
  followLogs: (appId: string, tail: number): ChildProcess =>
    spawn('docker', composeArgs(appId, 'logs', '--no-color', '--timestamps', '--follow', '--tail', String(tail))),
};

function parseJsonOutput(text: string): any[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  return trimmed.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export interface ContainerInfo {
  id: string;
  name: string;
  service: string;
  image: string;
  state: string;
  status: string;
  health: string;
}

export async function listContainers(appId: string): Promise<ContainerInfo[]> {
  const res = await run(['compose', '-p', projectName(appId), 'ps', '-a', '--format', 'json']);
  if (res.code !== 0) return [];
  return parseJsonOutput(res.stdout).map((c) => ({
    id: c.ID,
    name: c.Name,
    service: c.Service,
    image: c.Image,
    state: c.State,
    status: c.Status,
    health: c.Health ?? '',
  }));
}

export interface ContainerStats {
  name: string;
  cpu: string;
  memory: string;
  memoryPercent: string;
}

export async function containerStats(ids: string[]): Promise<ContainerStats[]> {
  if (!ids.length) return [];
  const res = await run(['stats', '--no-stream', '--format', '{{json .}}', ...ids], { timeoutMs: 15_000 });
  if (res.code !== 0) return [];
  return parseJsonOutput(res.stdout).map((s) => ({
    name: s.Name,
    cpu: s.CPUPerc,
    memory: s.MemUsage,
    memoryPercent: s.MemPerc,
  }));
}

export type ProjectState = 'running' | 'partial' | 'stopped' | 'missing';

/** One `docker compose ls` call gives the state of every app at once. */
export async function projectStates(): Promise<Map<string, ProjectState>> {
  const res = await run(['compose', 'ls', '-a', '--format', 'json']);
  const states = new Map<string, ProjectState>();
  if (res.code !== 0) return states;
  for (const p of parseJsonOutput(res.stdout)) {
    const status = String(p.Status ?? '');
    const running = status.includes('running');
    const other = /exited|created|paused|restarting|dead/.test(status);
    states.set(p.Name, running && other ? 'partial' : running ? 'running' : 'stopped');
  }
  return states;
}

export interface ImageInfo {
  id: string;
  tags: string[];
  size: number;
}

/** Looks up local images by reference or ID. Ones that don't exist are left out. */
export async function inspectImages(refs: string[]): Promise<ImageInfo[]> {
  if (!refs.length) return [];
  // Exits non-zero when any image is missing, but still prints the ones it found.
  const res = await run(['image', 'inspect', '--format', '{"id":{{json .Id}},"tags":{{json .RepoTags}},"size":{{.Size}}}', ...refs]);
  return parseJsonOutput(res.stdout).map((i) => ({ id: i.id, tags: i.tags ?? [], size: i.size }));
}

/** IDs of the images every container (running or stopped) was created from, or null if Docker can't say. */
export async function imagesInUse(): Promise<Set<string> | null> {
  const ps = await run(['ps', '-aq', '--no-trunc']);
  if (ps.code !== 0) return null;
  const ids = ps.stdout.split('\n').filter(Boolean);
  if (!ids.length) return new Set();
  const res = await run(['inspect', '--format', '{{.Image}}', ...ids]);
  if (res.code !== 0) return null;
  return new Set(res.stdout.split('\n').filter(Boolean));
}

/** Never forced, so Docker itself refuses if a container still uses the image. */
export async function removeImage(image: ImageInfo): Promise<boolean> {
  for (const tag of image.tags) await run(['image', 'rm', tag]);
  const res = await run(['image', 'rm', image.id]);
  // Removing the last tag already deletes the image, so "not found" here is success.
  return res.code === 0 || (await inspectImages([image.id])).length === 0;
}

export async function ensureEdgeNetwork(): Promise<void> {
  const inspect = await run(['network', 'inspect', config.edgeNetwork]);
  if (inspect.code === 0) return;
  const create = await run(['network', 'create', config.edgeNetwork]);
  if (create.code !== 0) throw new Error(`Could not create network ${config.edgeNetwork}: ${create.stderr}`);
}

// Docker Hub is the default registry and is addressed by leaving the host out.
const registryArg = (registry: string) => (registry === 'docker.io' ? [] : [registry]);

/** Signs in to a registry. Returns null on success, or Docker's explanation of what went wrong. */
export async function registryLogin(registry: string, username: string, token: string): Promise<string | null> {
  const res = await run(['login', ...registryArg(registry), '-u', username, '--password-stdin'], { input: token, timeoutMs: 30_000 });
  if (res.code === 0) return null;
  return lastLine(res.stderr);
}

export async function registryLogout(registry: string): Promise<void> {
  await run(['logout', ...registryArg(registry)]);
}

const CONNECTOR = 'dockyard-cloudflared';
const lastLine = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? 'Docker did not say why.';

/** What the connector should be started with. HTTP/2 avoids QUIC's UDP buffer needs, which containers cannot meet. */
export const CONNECTOR_PROTOCOL = 'http2';

/** The labels let Dockyard tell whether the running connector already uses the current token and protocol. */
export async function connectorState(): Promise<{ status: 'running' | 'stopped' | 'missing'; tokenId: string; protocol: string }> {
  const res = await run([
    'inspect',
    '--format',
    '{{.State.Running}} {{index .Config.Labels "dockyard.token"}} {{index .Config.Labels "dockyard.protocol"}}',
    CONNECTOR,
  ]);
  if (res.code !== 0) return { status: 'missing', tokenId: '', protocol: '' };
  const [running, tokenId = '', protocol = ''] = res.stdout.trim().split(' ');
  return { status: running === 'true' ? 'running' : 'stopped', tokenId, protocol };
}

/** True when the running connector matches the current token and protocol, so it can be left alone. */
export async function connectorUpToDate(tokenId: string): Promise<boolean> {
  const state = await connectorState();
  return state.status === 'running' && state.tokenId === tokenId && state.protocol === CONNECTOR_PROTOCOL;
}

/**
 * Runs the Cloudflare tunnel connector next to Traefik. The token travels in the
 * environment, not on the command line. Returns null on success, or Docker's explanation.
 */
export async function startConnector(token: string, tokenId: string): Promise<string | null> {
  await stopConnector();
  const res = await run(
    [
      'run', '-d', '--name', CONNECTOR, '--restart', 'unless-stopped', '--network', config.edgeNetwork,
      '--label', 'dockyard.role=connector', '--label', `dockyard.token=${tokenId}`, '--label', `dockyard.protocol=${CONNECTOR_PROTOCOL}`,
      '-e', 'TUNNEL_TOKEN',
      'cloudflare/cloudflared:latest', 'tunnel', '--no-autoupdate', '--protocol', CONNECTOR_PROTOCOL, 'run',
    ],
    { env: { TUNNEL_TOKEN: token }, timeoutMs: 180_000 },
  );
  return res.code === 0 ? null : lastLine(res.stderr);
}

/** The id Cloudflare knows the running connector by, or null when none is running. It is only in the connector's log. */
export async function connectorId(): Promise<string | null> {
  const res = await run(['logs', '--tail', '200', CONNECTOR]);
  return /Generated Connector ID: ([0-9a-f-]{36})/.exec(res.stdout + res.stderr)?.[1] ?? null;
}

/** Stops gracefully first, so the connector can tell Cloudflare it is leaving instead of dropping requests. */
export async function stopConnector(): Promise<void> {
  await run(['stop', '-t', '10', CONNECTOR]);
  await run(['rm', '-f', CONNECTOR]);
}

/** Waits until the connector reports a registered connection to Cloudflare. Returns null, or what its log says instead. */
export async function waitForConnector(timeoutMs = 30_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let log = '';
  while (Date.now() < deadline) {
    const res = await run(['logs', '--tail', '80', CONNECTOR]);
    log = res.stdout + res.stderr;
    if (/Registered tunnel connection/.test(log)) return null;
    if (/Unauthorized|Invalid tunnel secret|provided tunnel token is not valid/i.test(log)) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const errors = log.split('\n').filter((line) => / ERR /.test(line)).map((line) => line.replace(/^\S+ ERR /, '').trim());
  return errors.pop() ?? 'The connector did not report a connection to Cloudflare in time.';
}

export async function dockerAvailable(): Promise<boolean> {
  const res = await run(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 10_000 });
  return res.code === 0;
}
