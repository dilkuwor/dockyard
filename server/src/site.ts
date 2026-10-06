import { config } from './config.js';
import { decrypt, encrypt } from './crypto.js';
import { getSetting, setSetting } from './db.js';

/** How this Dockyard is reachable from the internet, if at all. Stored encrypted: it holds the tunnel token. */
export interface PublicAccess {
  enabled: boolean;
  mode: 'automatic' | 'manual';
  domain: string;
  tunnelToken: string;
  accountId?: string;
  zoneId?: string;
  tunnelId?: string;
  updatedAt: number;
}

const KEY = 'public_access';
let cached: PublicAccess | null | undefined;

export function publicAccess(): PublicAccess | null {
  if (cached === undefined) {
    const stored = getSetting(KEY);
    cached = stored ? (JSON.parse(decrypt(stored)) as PublicAccess) : null;
  }
  return cached;
}

export function savePublicAccess(value: PublicAccess | null): void {
  setSetting(KEY, value ? encrypt(JSON.stringify(value)) : null);
  cached = value;
}

/** The public domain while public access is on, otherwise null. */
export function publicDomain(): string | null {
  const access = publicAccess();
  return access?.enabled ? access.domain : null;
}

const localPortSuffix = () => (config.localPort === 80 ? '' : `:${config.localPort}`);

/** What follows the app's name in its address: "bytetech.cloud" or "localhost:8080". */
export function addressDomain(): string {
  return publicDomain() ?? `${config.localDomain}${localPortSuffix()}`;
}

/** Public HTTPS address when public access is on; otherwise the address on this machine. */
export function appUrl(slug: string): string {
  return `${publicDomain() ? 'https' : 'http'}://${slug}.${addressDomain()}`;
}

export const dashboardUrl = () => appUrl(config.dashboardSubdomain);

export const onboardingPending = () => getSetting('onboarding') !== 'done';
export const completeOnboarding = () => setSetting('onboarding', 'done');
