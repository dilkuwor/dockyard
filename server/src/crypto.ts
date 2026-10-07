import crypto from 'node:crypto';
import { config } from './config.js';

const encKey = crypto.createHash('sha256').update(`enc:${config.secret}`).digest();
const signKey = crypto.createHash('sha256').update(`sign:${config.secret}`).digest();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, ct] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function hmacHex(key: string | Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

export function randomId(length = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function newHookSecret(): string {
  return `dys_${crypto.randomBytes(32).toString('hex')}`;
}

export function newApiToken(): string {
  return `dyt_${crypto.randomBytes(32).toString('hex')}`;
}

export function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `version` is the password's version: changing the password signs every session out. */
export function createSessionToken(version: number): string {
  const exp = Date.now() + SESSION_TTL_MS;
  return `${exp}.${version}.${hmacHex(signKey, `session:${exp}:${version}`)}`;
}

export function verifySessionToken(token: string | undefined, currentVersion: number): boolean {
  if (!token) return false;
  const [expStr, versionStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now() || Number(versionStr) !== currentVersion) return false;
  return safeEqual(sig, hmacHex(signKey, `session:${exp}:${versionStr}`));
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;
