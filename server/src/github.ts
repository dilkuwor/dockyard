import { createRequire } from 'node:module';
import type Sodium from 'libsodium-wrappers';
import { decrypt, encrypt } from './crypto.js';

// The package's ESM entry imports a file it does not ship, so load the CommonJS build.
const sodium = createRequire(import.meta.url)('libsodium-wrappers') as typeof Sodium;
import { getSetting, setSetting } from './db.js';
import { HttpError, badRequest } from './errors.js';

/**
 * An optional GitHub token the admin adds on the dashboard's GitHub & Deploy Hooks page. With it, Dockyard can
 * store an app's deploy hook secret in the app's GitHub repository, so `dockyard deploy`
 * works without the GitHub CLI and without the user pasting the secret by hand.
 *
 * It is kept apart from the ghcr.io registry credential on purpose: that one only needs
 * read:packages, while writing Actions secrets is a far broader permission.
 */
const SETTING = 'github_automation';

interface Stored {
  token_enc: string;
  login: string;
  updatedAt: number;
}

export interface GithubStatus {
  configured: boolean;
  login: string | null;
  updatedAt: number | null;
}

function stored(): Stored | null {
  const raw = getSetting(SETTING);
  return raw ? (JSON.parse(raw) as Stored) : null;
}

export function hasGithubToken(): boolean {
  return stored() !== null;
}

export function githubStatus(): GithubStatus {
  const s = stored();
  return s ? { configured: true, login: s.login, updatedAt: s.updatedAt } : { configured: false, login: null, updatedAt: null };
}

const API = 'https://api.github.com';

async function gh(token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dockyard',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function ghError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    return data.message ? `${fallback} GitHub said: ${data.message}` : fallback;
  } catch {
    return fallback;
  }
}

/** Verifies the token against GitHub and stores it encrypted. Returns the account it belongs to. */
export async function saveGithubToken(token: string): Promise<GithubStatus> {
  let res: Response;
  try {
    res = await gh(token, 'GET', '/user');
  } catch {
    throw new HttpError(502, 'Could not reach api.github.com to verify the token.');
  }
  if (res.status === 401) throw badRequest('GitHub did not accept that token. Check that it was copied in full and has not expired.');
  if (!res.ok) throw new HttpError(502, await ghError(res, 'GitHub could not verify the token.'));
  const user = (await res.json()) as { login: string };
  const record: Stored = { token_enc: encrypt(token), login: user.login, updatedAt: Date.now() };
  setSetting(SETTING, JSON.stringify(record));
  return githubStatus();
}

export function removeGithubToken(): boolean {
  const had = hasGithubToken();
  setSetting(SETTING, null);
  return had;
}

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

export function normalizeRepo(value: unknown): string {
  const repo = String(value ?? '').trim().replace(/\.git$/, '');
  if (!REPO.test(repo)) throw badRequest('Give the repository as owner/name.');
  return repo;
}

export type SecretOutcome = 'added' | 'updated' | 'present';

/**
 * Makes sure the given Actions secrets exist in a repository. Existing secrets are left
 * alone unless `overwrite` is set, because GitHub never returns a secret's value, so
 * Dockyard cannot tell a correct one from a stale one.
 */
export async function ensureRepoSecrets(
  repo: string,
  secrets: Record<string, string>,
  overwrite: boolean,
): Promise<Record<string, SecretOutcome>> {
  const s = stored();
  if (!s) throw new HttpError(409, "Dockyard has no GitHub token. Add one on the dashboard's GitHub & Deploy Hooks page.");
  const token = decrypt(s.token_enc);

  let res: Response;
  try {
    res = await gh(token, 'GET', `/repos/${repo}/actions/secrets?per_page=100`);
  } catch {
    throw new HttpError(502, 'Could not reach api.github.com.');
  }
  if (res.status === 404) {
    throw new HttpError(
      404,
      `GitHub repository ${repo} was not found with Dockyard's token (@${s.login}). Check the name, or give that token access to the repository with the "Secrets: Read and write" permission.`,
    );
  }
  if (res.status === 401) throw new HttpError(409, `Dockyard's GitHub token (@${s.login}) no longer works. Replace it on the dashboard's GitHub & Deploy Hooks page.`);
  if (res.status === 403) {
    throw new HttpError(403, await ghError(res, `Dockyard's GitHub token (@${s.login}) may not manage Actions secrets in ${repo}. It needs the "Secrets: Read and write" repository permission (classic tokens: the repo scope).`));
  }
  if (!res.ok) throw new HttpError(502, await ghError(res, `GitHub could not list the secrets of ${repo}.`));
  const existing = new Set(((await res.json()) as { secrets: { name: string }[] }).secrets.map((x) => x.name));

  const outcomes: Record<string, SecretOutcome> = {};
  const toWrite = Object.entries(secrets).filter(([name]) => {
    if (existing.has(name) && !overwrite) {
      outcomes[name] = 'present';
      return false;
    }
    return true;
  });
  if (toWrite.length === 0) return outcomes;

  res = await gh(token, 'GET', `/repos/${repo}/actions/secrets/public-key`);
  if (!res.ok) throw new HttpError(502, await ghError(res, `GitHub did not return the secrets key for ${repo}.`));
  const key = (await res.json()) as { key_id: string; key: string };

  await sodium.ready;
  const publicKey = sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL);
  for (const [name, value] of toWrite) {
    const sealed = sodium.crypto_box_seal(sodium.from_string(value), publicKey);
    const put = await gh(token, 'PUT', `/repos/${repo}/actions/secrets/${name}`, {
      encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
      key_id: key.key_id,
    });
    if (put.status === 403) {
      throw new HttpError(403, await ghError(put, `Dockyard's GitHub token (@${s.login}) may not write Actions secrets in ${repo}. It needs the "Secrets: Read and write" repository permission (classic tokens: the repo scope).`));
    }
    if (!put.ok) throw new HttpError(502, await ghError(put, `GitHub refused to store ${name} in ${repo}.`));
    outcomes[name] = existing.has(name) ? 'updated' : 'added';
  }
  return outcomes;
}
