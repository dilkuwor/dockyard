import YAML from 'yaml';
import { badRequest } from './errors.js';

type Dict = Record<string, any>;
export interface ComposeDoc extends Dict {
  services: Record<string, Dict>;
}

const EDGE_KEY = 'dockyard_edge';
const RESERVED_LABEL = /^(traefik|dockyard)\./i;
const HOST_VALUES = new Set(['host']);

export function parseCompose(text: string): ComposeDoc {
  let doc: unknown;
  try {
    // Resolve "<<" merge keys like docker compose does, so merged-in settings are validated too.
    doc = YAML.parse(text, { merge: true });
  } catch (err) {
    throw badRequest(`Compose file is not valid YAML: ${(err as Error).message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw badRequest('Compose file must be a YAML mapping with a "services" key.');
  }
  const services = (doc as Dict).services;
  if (!services || typeof services !== 'object' || Array.isArray(services) || !Object.keys(services).length) {
    throw badRequest('Compose file must define at least one service under "services".');
  }
  for (const [name, svc] of Object.entries(services)) {
    if (!svc || typeof svc !== 'object' || Array.isArray(svc)) {
      throw badRequest(`Service "${name}" must be a mapping.`);
    }
  }
  return doc as ComposeDoc;
}

function labelsToMap(labels: unknown): Dict {
  if (!labels) return {};
  if (Array.isArray(labels)) {
    const out: Dict = {};
    for (const entry of labels) {
      const s = String(entry);
      const i = s.indexOf('=');
      out[i === -1 ? s : s.slice(0, i)] = i === -1 ? '' : s.slice(i + 1);
    }
    return out;
  }
  return { ...(labels as Dict) };
}

function envToMap(env: unknown): Dict {
  if (!env) return {};
  if (Array.isArray(env)) {
    const out: Dict = {};
    for (const entry of env) {
      const s = String(entry);
      const i = s.indexOf('=');
      if (i === -1) out[s] = null;
      else out[s.slice(0, i)] = s.slice(i + 1);
    }
    return out;
  }
  return { ...(env as Dict) };
}

function isBindSource(source: string): boolean {
  return /^(\/|\.|~|\$)/.test(source) || /^[a-zA-Z]:[\\/]/.test(source);
}

/**
 * Rejects anything that would let an app escape its sandbox or collide with
 * other apps: host access, bind mounts, published ports, shared/external
 * networks and volumes, and routing labels that Dockyard owns.
 */
export function validateCompose(doc: ComposeDoc, primaryService: string): void {
  const problems: string[] = [];

  if (!doc.services[primaryService]) {
    problems.push(`Service "${primaryService}" (the one that gets the URL) is not defined in the compose file.`);
  }

  for (const [name, svc] of Object.entries(doc.services)) {
    const p = (msg: string) => problems.push(`${name}: ${msg}`);

    if (svc.build) p('"build" is not supported. Push an image to a registry and reference it with "image".');
    if (!svc.image) p('every service needs an "image".');
    if (svc.ports) p('remove "ports". Apps are reachable through their Dockyard URL, not host ports.');
    if (svc.privileged) p('"privileged" is not allowed.');
    if (svc.network_mode) p('"network_mode" is not allowed; Dockyard manages networking.');
    for (const key of ['pid', 'ipc', 'uts', 'userns_mode', 'cgroup']) {
      if (svc[key] && HOST_VALUES.has(String(svc[key]))) p(`"${key}: host" is not allowed.`);
    }
    for (const key of ['cap_add', 'devices', 'device_cgroup_rules', 'security_opt', 'sysctls', 'cgroup_parent']) {
      if (svc[key]) p(`"${key}" is not allowed.`);
    }
    if (svc.container_name) p('remove "container_name"; it would collide with other apps.');
    if (svc.env_file) p('"env_file" is not supported. Set environment variables in Dockyard instead.');
    if (svc.extends) p('"extends" is not supported.');
    if (svc.volumes_from) p('"volumes_from" is not allowed.');

    const networks = Array.isArray(svc.networks) ? svc.networks : Object.keys(svc.networks ?? {});
    if (networks.includes(EDGE_KEY)) p(`network "${EDGE_KEY}" is reserved; Dockyard attaches the routed service to it.`);

    const labels = labelsToMap(svc.labels);
    const reserved = Object.keys(labels).filter((k) => RESERVED_LABEL.test(k));
    if (reserved.length) p(`labels starting with "traefik." or "dockyard." are managed by Dockyard: ${reserved.join(', ')}.`);

    if (Array.isArray(svc.volumes)) {
      for (const vol of svc.volumes) {
        if (typeof vol === 'string') {
          const parts = vol.split(':');
          if (parts.length > 1 && isBindSource(parts[0])) p(`bind mount "${vol}" is not allowed. Use a named volume.`);
        } else if (vol && typeof vol === 'object') {
          if (vol.type === 'bind' || vol.type === 'npipe') p(`"${vol.type}" volumes are not allowed. Use a named volume.`);
          if (vol.type !== 'tmpfs' && typeof vol.source === 'string' && isBindSource(vol.source)) {
            p(`volume source "${vol.source}" looks like a host path. Use a named volume.`);
          }
        }
      }
    } else if (svc.volumes) {
      p('"volumes" must be a list.');
    }
  }

  for (const [name, net] of Object.entries((doc.networks ?? {}) as Dict)) {
    if (name === EDGE_KEY) problems.push(`networks: "${EDGE_KEY}" is reserved.`);
    if (net && typeof net === 'object' && (net.external || net.name)) {
      problems.push(`networks.${name}: "external" and "name" are not allowed; networks are private to each app.`);
    }
  }
  for (const [name, vol] of Object.entries((doc.volumes ?? {}) as Dict)) {
    if (vol && typeof vol === 'object' && (vol.external || vol.name || vol.driver_opts || vol.driver)) {
      problems.push(`volumes.${name}: "external", "name", "driver" and "driver_opts" are not allowed.`);
    }
  }
  for (const key of ['secrets', 'configs']) {
    for (const [name, item] of Object.entries((doc[key] ?? {}) as Dict)) {
      if (item && typeof item === 'object' && (item.file || item.external || item.name)) {
        problems.push(`${key}.${name}: only "environment" or "content" sources are allowed.`);
      }
    }
  }
  if (doc.include) problems.push('"include" is not supported.');

  if (problems.length) throw badRequest('The compose file has settings Dockyard does not allow.', problems);
}

export function imageCompose(image: string, service = 'app'): string {
  return YAML.stringify({ services: { [service]: { image } } });
}

export function getServiceImage(composeText: string, service: string): string | null {
  try {
    return parseCompose(composeText).services[service]?.image ?? null;
  } catch {
    return null;
  }
}

export function setServiceImage(composeText: string, service: string, image: string): string {
  const doc = parseCompose(composeText);
  if (!doc.services[service]) throw badRequest(`Service "${service}" is not defined in the compose file.`);
  doc.services[service].image = image;
  return YAML.stringify(doc);
}

export interface RenderOptions {
  appId: string;
  slug: string;
  primaryService: string;
  port: number;
  env: { key: string; value: string }[];
  /** Services whose containers should not receive the app's variables, such as add-on databases. */
  envSkip?: string[];
  edgeNetwork: string;
  entrypoint: string;
}

/** Turns a validated user compose file into what actually runs. */
export function renderCompose(composeText: string, opts: RenderOptions): string {
  const doc = structuredClone(parseCompose(composeText));
  const router = `dy-${opts.appId}`;

  for (const [name, svc] of Object.entries(doc.services)) {
    const labels = labelsToMap(svc.labels);
    labels['dockyard.app'] = opts.appId;
    labels['dockyard.service'] = name;
    svc.labels = labels;
    svc.restart ??= 'unless-stopped';
  }

  const primary = doc.services[opts.primaryService];
  Object.assign(primary.labels, {
    'traefik.enable': 'true',
    // Match on the first label only, so the app answers on its local address and on
    // any public domain without being redeployed when public access is switched on or off.
    [`traefik.http.routers.${router}.rule`]: `HostRegexp(\`^${opts.slug}\\.\`)`,
    [`traefik.http.routers.${router}.entrypoints`]: opts.entrypoint,
    [`traefik.http.routers.${router}.service`]: router,
    [`traefik.http.services.${router}.loadbalancer.server.port`]: String(opts.port),
    'traefik.docker.network': opts.edgeNetwork,
  });

  if (!primary.networks) {
    primary.networks = ['default', EDGE_KEY];
  } else if (Array.isArray(primary.networks)) {
    if (!primary.networks.includes(EDGE_KEY)) primary.networks.push(EDGE_KEY);
  } else {
    primary.networks[EDGE_KEY] = {};
  }

  // Every service of the app gets the variables, so a worker or API next to the routed
  // service sees the same settings. They also fill ${VAR} placeholders anywhere in the file,
  // through the .env file written beside it. Add-on containers are left as defined.
  if (opts.env.length) {
    const skip = new Set(opts.envSkip ?? []);
    for (const [name, svc] of Object.entries(doc.services)) {
      if (skip.has(name)) continue;
      const env = envToMap(svc.environment);
      // Escape "$" so compose doesn't try to interpolate secret values.
      for (const { key, value } of opts.env) env[key] = value.replace(/\$/g, '$$$$');
      svc.environment = env;
    }
  }

  doc.networks = { ...(doc.networks ?? {}), [EDGE_KEY]: { external: true, name: opts.edgeNetwork } };
  return YAML.stringify(doc);
}
