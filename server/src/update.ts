import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { decrypt } from './crypto.js';
import { getSetting } from './db.js';
import { HttpError, badRequest } from './errors.js';
import { credentials } from './registries.js';

const exec = promisify(execFile);

/**
 * Self-update from the published image. The running container's image reference, such as
 * ghcr.io/dilkuwor/dockyard:latest, is compared with what the registry currently has behind
 * that tag. Applying an update is what you would do by hand: `docker compose pull` and
 * `docker compose up -d` for the dockyard service, run by a helper container because this
 * process cannot replace itself. Old images of Dockyard that nothing uses are removed after.
 */
const UPDATER = 'dockyard-updater';
const CHECK_TTL_MS = 30 * 60_000;
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export interface UpdateStatus {
  /** The image this container runs from, as written in the compose file. */
  image: string | null;
  running: {
    /** The registry digest of the running image, or null for an image built locally. */
    digest: string | null;
    /** The commit the image was built from, from its label, when the publisher set it. */
    revision: string | null;
    local: boolean;
  };
  latest: { digest: string | null };
  updateAvailable: boolean | null;
  repo: { owner: string; name: string; branch: string } | null;
  /** Commits newer than the running revision, for the "what's new" list. */
  commits: { sha: string; message: string; date: string; author: string }[];
  checkedAt: number | null;
  blocked: string | null;
  updater: { state: 'idle' | 'running' | 'done' | 'failed'; startedAt: number | null };
}

interface Self {
  image: string;
  imageId: string;
  digest: string | null;
  revision: string | null;
  source: string | null;
  workingDir: string;
  configFiles: string[];
}

const cache: { at: number; image: string; latest: string | null; blocked: string | null; commits: UpdateStatus['commits'] } = {
  at: 0,
  image: '',
  latest: null,
  blocked: null,
  commits: [],
};

/** Everything about this very container that the update needs, from Docker's own metadata. */
async function self(): Promise<Self> {
  const fmt = [
    '{{.Config.Image}}',
    '{{.Image}}',
    '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
    '{{index .Config.Labels "com.docker.compose.project.config_files"}}',
  ].join('|');
  const { stdout } = await exec('docker', ['inspect', '--format', fmt, os.hostname()]);
  const [image, imageId, workingDir, files] = stdout.trim().split('|');
  const img = await exec('docker', [
    'image',
    'inspect',
    '--format',
    '{{join .RepoDigests ","}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "org.opencontainers.image.source"}}',
    imageId,
  ]);
  const [digests, revision, source] = img.stdout.trim().split('|');
  const repo = image.split('@')[0].replace(/:[^/]+$/, '');
  const digest = digests.split(',').map((d) => d.trim()).find((d) => d.startsWith(`${repo}@`))?.split('@')[1] ?? null;
  return {
    image,
    imageId,
    digest,
    revision: revision && revision !== 'unknown' ? revision : null,
    source: source || null,
    workingDir,
    configFiles: files ? files.split(',') : [],
  };
}

/** Splits "ghcr.io/owner/name:tag" into its parts; Docker Hub shorthand gets its real registry and namespace. */
function parseRef(ref: string): { host: string; repo: string; tag: string } {
  const [path, tag = 'latest'] = ref.split('@')[0].split(/:(?=[^/]+$)/);
  const parts = path.split('/');
  const hasHost = parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost');
  const host = hasHost ? parts[0] : 'registry-1.docker.io';
  let repo = hasHost ? parts.slice(1).join('/') : path;
  if (!hasHost && !repo.includes('/')) repo = `library/${repo}`;
  return { host, repo, tag };
}

/** The digest the registry serves for a tag right now, with token auth discovered from the registry itself. */
async function registryDigest(ref: string): Promise<string> {
  const { host, repo, tag } = parseRef(ref);
  const url = `https://${host}/v2/${repo}/manifests/${encodeURIComponent(tag)}`;
  const cred = credentials().find((c) => c.registry === (host === 'registry-1.docker.io' ? 'docker.io' : host));
  const basic = cred ? `Basic ${Buffer.from(`${cred.username}:${cred.token}`).toString('base64')}` : null;

  let res = await fetch(url, { method: 'HEAD', headers: { Accept: ACCEPT, ...(basic ? { Authorization: basic } : {}) }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) {
    const challenge = res.headers.get('www-authenticate') ?? '';
    const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
    const service = /service="([^"]+)"/.exec(challenge)?.[1];
    const scope = /scope="([^"]+)"/.exec(challenge)?.[1] ?? `repository:${repo}:pull`;
    if (!realm) throw new Error(`${host} wants authentication but did not say how.`);
    const tokenUrl = `${realm}?service=${encodeURIComponent(service ?? host)}&scope=${encodeURIComponent(scope)}`;
    const tokenRes = await fetch(tokenUrl, { headers: basic ? { Authorization: basic } : {}, signal: AbortSignal.timeout(15_000) });
    if (!tokenRes.ok) {
      throw new Error(
        tokenRes.status === 401 || tokenRes.status === 403
          ? `${host} refused access to ${repo}. If the package is private, add credentials for ${host} under Settings, or make the package public.`
          : `${host} token service answered ${tokenRes.status}.`,
      );
    }
    const token = ((await tokenRes.json()) as { token?: string; access_token?: string });
    const bearer = token.token ?? token.access_token;
    if (!bearer) throw new Error(`${host} did not return a token.`);
    res = await fetch(url, { method: 'HEAD', headers: { Accept: ACCEPT, Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(15_000) });
  }
  if (res.status === 404) throw new Error(`${ref} does not exist in the registry.`);
  if (!res.ok) throw new Error(`${host} answered ${res.status} for ${repo}:${tag}.`);
  const digest = res.headers.get('docker-content-digest');
  if (!digest) throw new Error(`${host} did not return a digest for ${repo}:${tag}.`);
  return digest;
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

/** The GitHub repository behind the image: from its source label, or ghcr.io's owner/name. */
function repoFor(s: Self): UpdateStatus['repo'] {
  const m = /github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/.exec(s.source ?? '');
  if (m) return { owner: m[1], name: m[2], branch: 'main' };
  const ref = parseRef(s.image);
  if (ref.host === 'ghcr.io') {
    const [owner, name] = ref.repo.split('/');
    if (owner && name) return { owner, name, branch: 'main' };
  }
  return null;
}

async function commitsSince(repo: NonNullable<UpdateStatus['repo']>, revision: string | null): Promise<UpdateStatus['commits']> {
  const token = githubToken();
  const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/commits?sha=${encodeURIComponent(repo.branch)}&per_page=50`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dockyard', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const list = (await res.json()) as { sha: string; commit: { message: string; author?: { date?: string; name?: string } } }[];
  const commits = list.map((c) => ({ sha: c.sha, message: c.commit.message.split('\n')[0].slice(0, 200), date: c.commit.author?.date ?? '', author: c.commit.author?.name ?? '' }));
  const index = revision ? commits.findIndex((c) => c.sha === revision) : -1;
  return index === -1 ? commits.slice(0, 10) : commits.slice(0, index);
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
  const updater = await updaterState();
  let s: Self;
  try {
    s = await self();
  } catch (err) {
    return {
      image: null, running: { digest: null, revision: null, local: true }, latest: { digest: null }, updateAvailable: null, repo: null,
      commits: [], checkedAt: null, blocked: `Could not inspect this container: ${(err as Error).message}`, updater,
    };
  }
  const repo = repoFor(s);
  const base = { image: s.image, running: { digest: s.digest, revision: s.revision, local: s.digest === null }, repo, updater };
  const { host } = parseRef(s.image);
  if (!s.image.includes('/') || host === 'localhost') {
    return { ...base, latest: { digest: null }, updateAvailable: null, commits: [], checkedAt: null, blocked: `This Dockyard runs a locally built image (${s.image}). Updates come from a published image; point the compose file at one to use this.` };
  }

  if (!refresh && cache.image === s.image && Date.now() - cache.at < CHECK_TTL_MS) {
    return { ...base, latest: { digest: cache.latest }, updateAvailable: cache.latest ? cache.latest !== s.digest : null, commits: cache.commits, checkedAt: cache.at, blocked: cache.blocked };
  }

  let latest: string | null = null;
  let blocked: string | null = null;
  let commits: UpdateStatus['commits'] = [];
  try {
    latest = await registryDigest(s.image);
    if (repo) commits = await commitsSince(repo, s.revision).catch(() => []);
    if (s.digest === null) blocked = 'The running image was built on this machine, so it cannot be matched against the registry. Updating replaces it with the published image.';
  } catch (err) {
    blocked = (err as Error).message;
  }
  Object.assign(cache, { at: Date.now(), image: s.image, latest, blocked, commits });
  return { ...base, latest: { digest: latest }, updateAvailable: latest ? latest !== s.digest : null, commits, checkedAt: cache.at, blocked };
}

/**
 * Starts the helper that pulls the published image, recreates the dockyard service from it,
 * and removes Dockyard images that nothing uses any more. Returns at once; the dashboard is
 * away for a minute while the new container starts.
 */
export async function applyUpdate(): Promise<{ started: true }> {
  const status = await updateStatus();
  if (status.updater.state === 'running') throw badRequest('An update is already running.');
  if (!status.image || status.latest.digest === null) throw badRequest(status.blocked ?? 'Could not determine the published image.');
  const s = await self();
  if (!s.workingDir) throw new HttpError(500, 'Could not find the compose project this Dockyard runs from.');
  const { host } = parseRef(s.image);
  const cred = credentials().find((c) => c.registry === (host === 'registry-1.docker.io' ? 'docker.io' : host));
  const repo = s.image.split('@')[0].replace(/:[^/]+$/, '');
  const composeFiles = s.configFiles.flatMap((f) => ['-f', f]);

  const script = [
    'set -e',
    '[ -z "$REGISTRY_USER" ] || echo "$REGISTRY_TOKEN" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin',
    `echo "Pulling ${s.image}"`,
    `docker compose ${composeFiles.join(' ')} pull --quiet dockyard`,
    'echo "Recreating the dockyard service from the new image"',
    `docker compose ${composeFiles.join(' ')} up -d --no-build dockyard`,
    'sleep 2',
    'echo "Removing Dockyard images that are no longer used"',
    // The previous image loses its tag when the pull moves it, so it is named by id; any other stale tags of the repo go too.
    '[ -z "$OLD_IMAGE" ] || docker image rm "$OLD_IMAGE" >/dev/null 2>&1 && echo "  removed the previous image" || true',
    `for id in $(docker images "${repo}" -q | sort -u); do docker image rm "$id" >/dev/null 2>&1 && echo "  removed $id" || true; done`,
    'echo "Update finished."',
  ].join('\n');

  await exec('docker', ['rm', '-f', UPDATER]).catch(() => undefined);
  await exec('docker', [
    'run', '-d', '--name', UPDATER,
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${s.workingDir}:${s.workingDir}`,
    '-w', s.workingDir,
    '-e', `REGISTRY=${host === 'registry-1.docker.io' ? 'docker.io' : host}`,
    '-e', `REGISTRY_USER=${cred?.username ?? ''}`,
    '-e', `REGISTRY_TOKEN=${cred?.token ?? ''}`,
    '-e', `OLD_IMAGE=${s.imageId}`,
    'docker:cli', 'sh', '-c', script,
  ]);
  cache.at = 0;
  return { started: true };
}

export async function updateLog(): Promise<string> {
  try {
    const { stdout, stderr } = await exec('docker', ['logs', '--tail', '200', UPDATER]);
    return stdout + stderr;
  } catch {
    return '';
  }
}
