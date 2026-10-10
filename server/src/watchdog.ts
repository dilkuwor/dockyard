import http from 'node:http';
import { config } from './config.js';
import { sha256Hex } from './crypto.js';
import { connectorState, startConnector, waitForConnector } from './docker.js';
import { dashboardUrl, publicAccess } from './site.js';

/**
 * Registration at startup proves the connector connected once, not that requests still flow.
 * Every minute this asks for the dashboard's health through the public address and, separately,
 * through Traefik on the local network. Public failing while local works means the connector is
 * wedged, and it gets restarted, with a backoff so a short Cloudflare blip does not flap it.
 */
const INTERVAL_MS = 60_000;
const FAILURES_BEFORE_RESTART = 2;
const MIN_RESTART_GAP_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 8_000;

export interface WatchdogStatus {
  lastCheck: number | null;
  publicOk: boolean | null;
  localOk: boolean | null;
  consecutiveFailures: number;
  restarts: { at: number; reason: string; ok: boolean }[];
}

const state: WatchdogStatus = { lastCheck: null, publicOk: null, localOk: null, consecutiveFailures: 0, restarts: [] };
let running = false;

export const watchdogStatus = (): WatchdogStatus => ({ ...state, restarts: state.restarts.slice(-10) });

async function probePublic(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: 'manual' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Through Traefik on the edge network, with the public Host header, so it exercises the same route. */
function probeLocal(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: 'traefik', port: 80, path: '/api/health', method: 'GET', headers: { host }, timeout: PROBE_TIMEOUT_MS },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 400);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function check(log: (msg: string) => void): Promise<void> {
  const access = publicAccess();
  if (!access?.enabled) return;
  if ((await connectorState()).status !== 'running') return; // ensureConnector owns a missing container

  const url = dashboardUrl();
  const [publicOk, localOk] = await Promise.all([probePublic(`${url}/api/health`), probeLocal(new URL(url).host)]);
  state.lastCheck = Date.now();
  state.publicOk = publicOk;
  state.localOk = localOk;

  if (publicOk || !localOk) {
    // Either all is well, or the problem is on this machine and a connector restart would not help.
    state.consecutiveFailures = 0;
    return;
  }
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures < FAILURES_BEFORE_RESTART) return;
  const last = state.restarts.at(-1);
  if (last && Date.now() - last.at < MIN_RESTART_GAP_MS) return;

  const reason = `${url} failed ${state.consecutiveFailures} checks in a row while Traefik answered locally`;
  log(`Watchdog: restarting the Cloudflare connector. ${reason}.`);
  const error = await startConnector(access.tunnelToken, sha256Hex(access.tunnelToken).slice(0, 12));
  const connectError = error ?? (await waitForConnector());
  state.restarts.push({ at: Date.now(), reason, ok: !connectError });
  state.consecutiveFailures = 0;
  if (connectError) log(`Watchdog: the connector did not come back cleanly: ${connectError}`);
}

export function startWatchdog(log: (msg: string) => void): void {
  if (running) return;
  running = true;
  const tick = () => {
    void check(log).catch((err) => log(`Watchdog check failed: ${(err as Error).message}`));
  };
  setTimeout(tick, Math.min(INTERVAL_MS, config.deployTimeoutSeconds * 1000)).unref();
  setInterval(tick, INTERVAL_MS).unref();
}
