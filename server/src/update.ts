import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { decrypt } from './crypto.js';
import { getSetting } from './db.js';
import { HttpError, badRequest } from './errors.js';

const exec = promisify(execFile);

/**
 * Self-update. The image records the commit it was built from; the checkout the stack runs
 * from is mounted at /src. Updates are found through the GitHub API and applied by a helper
 * container that pulls the checkout forward and runs `docker compose up -d --build` for the
 * dockyard service, since this process cannot rebuild and replace itself from the inside.
 */
const SRC = process.env.SRC_DIR ?? '/src';
const BUILD_SHA_FILE = process.env.BUILD_SHA_FILE ?? '/app/BUILD_SHA';
const UPDATER = 'dockyard-updater';
const CHECK_TTL_MS = 30 * 60_000;

export interface UpdateStatus {
  /** The commit the running image was built from, or null when the image was built without it. */
  running: string | null;
  /** HEAD of the checkout at /src, or null when it is not mounted. */
  checkout: string | null;
  repo: { owner: string; name: string; branch: string } | null;
  latest: string | null;
  behind: number | null;
  commits: { sha: string; message: string; date: string; author: string }[];
  checkedAt: number | null;
  /** Why an update cannot be checked or applied, if it cannot. */
  blocked: string | null;
  updater: { state: 'idle' | 'running' | 'done' | 'failed'; startedAt: number | null };
}

const cache: { at: number; result: Omit<UpdateStatus, 'updater' | 'running' | 'checkout'> | null } = { at: 0, result: null };

export function buildSha(): string | null {
  try {
    const sha = fs.readFileSync(BUILD_SHA_FILE, 'utf8').trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Resolves HEAD of the mounted checkout without git: a ref file or packed-refs. */
export function checkoutSha(): string | null {
  try {
    const head = fs.readFileSync(path.join(SRC, '.git', 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = head.replace(/^ref:\s*/, '');
    const refFile = path.join(SRC, '.git', ref);
    if (fs.existsSync(refFile)) return fs.readFileSync(refFile, 'utf8').trim();
    const packed = fs.readFileSync(path.join(SRC, '.git', 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
    return line ? line.split(' ')[0] : null;
  } catch {
    return null;
  }
}

/** Which GitHub repository and branch the checkout follows, from its own git metadata. */
export function repoInfo(): UpdateStatus['repo'] {
  try {
    const head = fs.readFileSync(path.join(SRC, '.git', 'HEAD'), 'utf8').trim();
    const branch = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : 'main';
    const cfg = fs.readFileSync(path.join(SRC, '.git', 'config'), 'utf8');
    const origin = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(cfg)?.[1] ?? '';
    const m = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/.exec(origin);
    if (!m) return null;
    return { owner: m[1], name: m[2], branch };
  } catch {
    return null;
  }
}

function githubToken(): string | null {
  const raw = getSetting('github_automation');
  if (!raw) return null;
  try {
    return decrypt((JSON.parse(raw) as { token_enc: string }).token_enc);
  } catch {
    return null;
  }
}

async function fetchCommits(repo: NonNullable<UpdateStatus['repo']>): Promise<{ sha: string; message: string; date: string; author: string }[]> {
  const token = githubToken();
  const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/commits?sha=${encodeURIComponent(repo.branch)}&per_page=50`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dockyard',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error(`GitHub cannot see ${repo.owner}/${repo.name}. For a private repository, add a GitHub token under GitHub & Deploy Hooks.`);
  if (!res.ok) throw new Error(`GitHub answered with status ${res.status}.`);
  const list = (await res.json()) as { sha: string; commit: { message: string; author?: { date?: string; name?: string } } }[];
  return list.map((c) => ({ sha: c.sha, message: c.commit.message.split('\n')[0].slice(0, 200), date: c.commit.author?.date ?? '', author: c.commit.author?.name ?? '' }));
}

async function updaterState(): Promise<UpdateStatus['updater']> {
  try {
    const { stdout } = await exec('docker', ['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}} {{.State.StartedAt}}', UPDATER]);
    const [running, exitCode, startedAt] = stdout.trim().split(' ');
    return { state: running === 'true' ? 'running' : exitCode === '0' ? 'done' : 'failed', startedAt: Date.parse(startedAt) || null };
  } catch {
    return { state: 'idle', startedAt: null };
  }
}

export async function updateStatus(refresh = false): Promise<UpdateStatus> {
  const running = buildSha();
  const checkout = checkoutSha();
  const updater = await updaterState();
  const repo = repoInfo();
  const base = { running, checkout, updater };

  if (!fs.existsSync(path.join(SRC, '.git'))) {
    return { ...base, repo: null, latest: null, behind: null, commits: [], checkedAt: null, blocked: 'The checkout is not mounted at /src. Pull the latest docker-compose.yml and run docker compose up -d once by hand.' };
  }
  if (!repo) {
    return { ...base, repo: null, latest: null, behind: null, commits: [], checkedAt: null, blocked: 'The checkout has no GitHub remote named origin, so there is nothing to check against.' };
  }

  if (!refresh && cache.result && Date.now() - cache.at < CHECK_TTL_MS) return { ...base, ...cache.result };

  const reference = running ?? checkout;
  let result: Omit<UpdateStatus, 'updater' | 'running' | 'checkout'>;
  try {
    const commits = await fetchCommits(repo);
    const index = reference ? commits.findIndex((c) => c.sha === reference) : -1;
    const ahead = index === -1 ? commits : commits.slice(0, index);
    result = {
      repo,
      latest: commits[0]?.sha ?? null,
      behind: reference && index === -1 ? null : ahead.length,
      commits: ahead,
      checkedAt: Date.now(),
      blocked: running ? null : 'The running image was built without its commit recorded, so "behind" is measured from the checkout instead. The next update fixes that.',
    };
  } catch (err) {
    result = { repo, latest: null, behind: null, commits: [], checkedAt: Date.now(), blocked: (err as Error).message };
  }
  cache.at = Date.now();
  cache.result = result;
  return { ...base, ...result };
}

/** The host path and compose files of this very container, from the labels compose put on it. */
async function ownCompose(): Promise<{ workingDir: string; configFiles: string[] }> {
  const { stdout } = await exec('docker', [
    'inspect',
    '--format',
    '{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}',
    os.hostname(),
  ]);
  const [workingDir, files] = stdout.trim().split('|');
  if (!workingDir) throw new HttpError(500, 'Could not find the compose project this Dockyard runs from.');
  return { workingDir, configFiles: files ? files.split(',') : [] };
}

/**
 * Starts the helper that pulls the checkout forward and rebuilds the dockyard service.
 * This request returns at once; the dashboard goes away for a minute while the new image starts.
 */
export async function applyUpdate(): Promise<{ started: true }> {
  const status = await updateStatus();
  if (status.blocked && status.running) throw badRequest(status.blocked);
  if (!status.repo) throw badRequest('There is no repository to update from.');
  if (status.updater.state === 'running') throw badRequest('An update is already running.');

  const { workingDir, configFiles } = await ownCompose();
  const token = githubToken();
  const remote = token
    ? `https://x-access-token:${token}@github.com/${status.repo.owner}/${status.repo.name}.git`
    : `https://github.com/${status.repo.owner}/${status.repo.name}.git`;
  const composeFiles = configFiles.flatMap((f) => ['-f', f]);
  const script = [
    'set -e',
    "git config --global --add safe.directory '*'",
    'OWNER_UID=$(stat -c %u .); OWNER_GID=$(stat -c %g .)',
    'echo "Fetching $BRANCH from GitHub"',
    'git fetch --quiet "$REMOTE" "$BRANCH"',
    'git merge --ff-only FETCH_HEAD',
    'chown -R "$OWNER_UID:$OWNER_GID" .git',
    'git diff --name-only ORIG_HEAD HEAD 2>/dev/null | xargs -r chown "$OWNER_UID:$OWNER_GID" || true',
    'echo "Now at $(git rev-parse --short HEAD). Rebuilding dockyard."',
    `docker compose ${composeFiles.join(' ')} up -d --build dockyard`,
    'echo "Update finished."',
  ].join('\n');

  await exec('docker', ['rm', '-f', UPDATER]).catch(() => undefined);
  await exec('docker', [
    'run', '-d', '--name', UPDATER,
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${workingDir}:${workingDir}`,
    '-w', workingDir,
    '-e', `REMOTE=${remote}`,
    '-e', `BRANCH=${status.repo.branch}`,
    'docker:cli', 'sh', '-c', script,
  ]);
  cache.result = null;
  return { started: true };
}

export async function updateLog(): Promise<string> {
  try {
    const { stdout, stderr } = await exec('docker', ['logs', '--tail', '200', UPDATER]);
    return (stdout + stderr).replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
  } catch {
    return '';
  }
}
