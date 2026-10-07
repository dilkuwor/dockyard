import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { safeEqual } from './crypto.js';
import { getSetting, setSetting } from './db.js';
import { badRequest } from './errors.js';

/**
 * The dashboard password. It is chosen on the first visit and kept as a scrypt hash in
 * the settings table. ADMIN_PASSWORD in .env is still honoured for older installs: on
 * first boot it is imported into the table, after which the stored password wins.
 *
 * Until a password exists, the setup form is open to whoever reaches the dashboard, so
 * it also asks for a one-time code that is printed to the container logs. Only someone
 * with shell access to the host can read it.
 */
const SETTING = 'admin_password';
const scrypt = promisify<string, Buffer, number, crypto.ScryptOptions, Buffer>(crypto.scrypt);
// 128 * N * r bytes = 32 MiB, which is exactly Node's default maxmem, so raise it.
const SCRYPT: crypto.ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;

interface Stored {
  salt: string;
  hash: string;
  /** Bumped on every change; sessions carry it so a new password signs the old ones out. */
  version: number;
  updatedAt: number;
}

function stored(): Stored | null {
  const raw = getSetting(SETTING);
  return raw ? (JSON.parse(raw) as Stored) : null;
}

export const passwordSet = (): boolean => stored() !== null;
export const passwordVersion = (): number => stored()?.version ?? 0;
export const passwordUpdatedAt = (): number | null => stored()?.updatedAt ?? null;

async function hash(plain: string, salt: Buffer): Promise<Buffer> {
  return scrypt(plain, salt, KEY_LENGTH, SCRYPT);
}

export function validatePassword(plain: unknown): string {
  if (typeof plain !== 'string' || plain.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (plain.length > 256) throw badRequest('That password is too long.');
  return plain;
}

export async function setPassword(plain: string): Promise<void> {
  const salt = crypto.randomBytes(16);
  const record: Stored = {
    salt: salt.toString('base64'),
    hash: (await hash(plain, salt)).toString('base64'),
    version: passwordVersion() + 1,
    updatedAt: Date.now(),
  };
  setSetting(SETTING, JSON.stringify(record));
}

export async function verifyPassword(plain: string): Promise<boolean> {
  const s = stored();
  if (s) {
    const candidate = await hash(plain, Buffer.from(s.salt, 'base64'));
    const expected = Buffer.from(s.hash, 'base64');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }
  // No stored password yet: only the legacy environment variable can sign in.
  return config.adminPassword !== undefined && safeEqual(plain, config.adminPassword);
}

/** True when the dashboard has no password at all and the first visit must create one. */
export const setupRequired = (): boolean => !passwordSet() && config.adminPassword === undefined;

let code: string | null = null;

export const setupCode = (): string | null => code;

export function verifySetupCode(candidate: unknown): boolean {
  if (!code || typeof candidate !== 'string') return false;
  return safeEqual(candidate.replace(/[\s-]/g, '').toUpperCase(), code.replace(/-/g, ''));
}

/** Run once at boot: import a legacy ADMIN_PASSWORD, or print the setup code the first visit will need. */
export async function initPassword(): Promise<void> {
  if (passwordSet()) return;
  if (config.adminPassword !== undefined) {
    await setPassword(config.adminPassword);
    console.log('Imported ADMIN_PASSWORD from the environment as the dashboard password. You can remove it from .env now.');
    return;
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
  const bytes = crypto.randomBytes(8);
  const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  console.log(
    [
      '',
      '==================================================================',
      '  Dockyard has no admin password yet.',
      '  Open the dashboard and create one. The setup form asks for this',
      `  one-time code:    ${code}`,
      '==================================================================',
      '',
    ].join('\n'),
  );
}
