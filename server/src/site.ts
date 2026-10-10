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
  /** Further domains apps can live under. They ride the same tunnel; `domain` stays the dashboard's. */
  extraDomains?: { domain: string; zoneId?: string }[];
  /** Where new apps go when no domain is given. Falls back to `domain`. */
  defaultDomain?: string;
  /** The Cloudflare API token from setup, kept so domains can be added later without asking again. */
  apiToken?: string;
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

/** The dashboard's public domain while public access is on, otherwise null. */
export function publicDomain(): string | null {
  const access = publicAccess();
  return access?.enabled ? access.domain : null;
}

/** Every domain apps can be assigned to, the dashboard's first, whether public access is on right now or not. */
export function configuredDomains(): string[] {
  const access = publicAccess();
  if (!access) return [];
  return [access.domain, ...(access.extraDomains ?? []).map((d) => d.domain)];
}

/** The domain new apps get when none is chosen. */
export function defaultDomain(): string | null {
  const access = publicAccess();
  if (!access) return null;
  return access.defaultDomain && configuredDomains().includes(access.defaultDomain) ? access.defaultDomain : access.domain;
}

/** The domain an app is served on: its own if that is still configured, else the dashboard's. Null without public access. */
export function resolveDomain(domain: string | null | undefined): string | null {
  const primary = publicDomain();
  if (!primary) return null;
  return domain && configuredDomains().includes(domain) ? domain : primary;
}

const localPortSuffix = () => (config.localPort === 80 ? '' : `:${config.localPort}`);

/** What follows the app's name in its address: "bytetech.cloud" or "localhost:8080". */
export function addressDomain(): string {
  return publicDomain() ?? `${config.localDomain}${localPortSuffix()}`;
}

/** Public HTTPS address when public access is on; otherwise the address on this machine. */
export function appUrl(slug: string, domain?: string | null): string {
  const chosen = resolveDomain(domain);
  return chosen ? `https://${slug}.${chosen}` : `http://${slug}.${addressDomain()}`;
}

export const dashboardUrl = () => appUrl(config.dashboardSubdomain);

export const onboardingPending = () => getSetting('onboarding') !== 'done';
export const completeOnboarding = () => setSetting('onboarding', 'done');
