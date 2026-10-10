export type AppState = 'running' | 'partial' | 'stopped' | 'missing'
export type DeploymentStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface Deployment {
  id: string
  status: DeploymentStatus
  trigger: 'create' | 'manual' | 'webhook' | 'rollback'
  image: string | null
  commitSha: string | null
  commitMessage: string | null
  branch: string | null
  rollbackOf: string | null
  createdAt: number
  finishedAt: number | null
  log?: string
}

export interface DeploymentDiff {
  previous: { id: string; createdAt: number; status: DeploymentStatus } | null
  image: { before: string | null; after: string | null }
  compose: { before: string; after: string; changed: boolean }
  env: { added: string[]; removed: string[]; changed: string[] }
}

export type AddonType = 'postgres' | 'redis' | 'minio'

export interface AddonInfo {
  type: AddonType
  label: string
  service: string
  envKeys: string[]
  note: string
  added: boolean
  addedAt: number | null
}

export interface HostnameInfo {
  hostname: string
  cloudflare: boolean
  createdAt: number
}

export interface BackupSettings {
  enabled: boolean
  time: string
  retention: number
}

export interface BackupSummary {
  id: string
  kind: 'scheduled' | 'manual'
  status: 'running' | 'succeeded' | 'failed'
  startedAt: number
  finishedAt: number | null
  size: number
}

export interface BackupDetail extends BackupSummary {
  log: string
  items: { appId: string; appName: string; size: number; status: 'succeeded' | 'failed' | 'empty'; detail: string | null }[]
}

export interface AppBackup {
  backupId: string
  startedAt: number
  kind: string
  size: number
  detail: string | null
}

export interface UpdateStatus {
  running: string | null
  checkout: string | null
  repo: { owner: string; name: string; branch: string } | null
  latest: string | null
  behind: number | null
  commits: { sha: string; message: string; date: string; author: string }[]
  checkedAt: number | null
  blocked: string | null
  updater: { state: 'idle' | 'running' | 'done' | 'failed'; startedAt: number | null }
}

export interface AppSummary {
  id: string
  name: string
  slug: string
  domain: string | null
  url: string
  hostnames: string[]
  addons: AddonType[]
  deployBranch: string | null
  previewsEnabled: boolean
  previewOf: string | null
  branch: string | null
  backupEnabled: boolean
  sourceType: 'image' | 'compose'
  primaryService: string
  port: number
  image: string | null
  currentDeploymentId: string | null
  lastDeployment: Deployment | null
  createdAt: number
  updatedAt: number
  state?: AppState
}

export interface Container {
  id: string
  name: string
  service: string
  image: string
  state: string
  status: string
  health: string
}

export interface AppDetail extends AppSummary {
  compose: string
  containers: Container[]
}

export interface ContainerStats {
  name: string
  cpu: string
  memory: string
  memoryPercent: string
}

export interface EnvVar {
  key: string
  value: string
}

export interface UnusedImage {
  id: string
  name: string
  size: number
}

export interface ApiToken {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

export interface GlobalHook {
  enabled: boolean
  url: string
  secret?: string
}

export interface RegistryCredential {
  registry: string
  name: string
  username: string
  source: 'dashboard' | 'env'
  updatedAt: number | null
}

export interface GithubStatus {
  configured: boolean
  login: string | null
  updatedAt: number | null
}

export interface PublicAccessStatus {
  configured: boolean
  enabled: boolean
  mode: 'automatic' | 'manual' | null
  domain: string | null
  connector: 'running' | 'stopped' | 'missing'
  watchdog: {
    lastCheck: number | null
    publicOk: boolean | null
    localOk: boolean | null
    consecutiveFailures: number
    restarts: { at: number; reason: string; ok: boolean }[]
  }
  hasApiToken: boolean
  domains: { domain: string; primary: boolean; default: boolean; apps: number }[]
  dashboardUrl: string
  localDashboardUrl: string
  exampleAppUrl: string
}

export interface SetupStep {
  name: string
  status: 'ok' | 'warning' | 'failed'
  detail: string
}

export interface SetupResult {
  ok: boolean
  steps: SetupStep[]
  status: PublicAccessStatus
}

export class ApiError extends Error {
  status: number
  details?: string[]
  constructor(status: number, message: string, details?: string[]) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Mutations always carry a JSON body, even an empty one: proxies in front of a public Dockyard
  // forward bodyless POSTs in a form the server would otherwise reject as 415.
  const sendBody = body !== undefined || method !== 'GET'
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: sendBody ? { 'Content-Type': 'application/json' } : undefined,
    body: sendBody ? JSON.stringify(body ?? {}) : undefined,
  })
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event('dockyard:signed-out'))
  }
  const text = await res.text()
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson && text ? JSON.parse(text) : text
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed with status ${res.status}.`, data?.details)
  }
  return data as T
}

export const api = {
  me: () => request<{ ok: true }>('GET', '/api/auth/me'),
  authStatus: () => request<{ setupRequired: boolean; minPasswordLength: number }>('GET', '/api/auth/status'),
  setup: (password: string, code: string) => request<{ ok: true }>('POST', '/api/auth/setup', { password, code }),
  login: (password: string) => request<{ ok: true }>('POST', '/api/auth/login', { password }),
  passwordInfo: () => request<{ updatedAt: number | null }>('GET', '/api/auth/password'),
  changePassword: (current: string, next: string) =>
    request<{ ok: true; updatedAt: number | null }>('POST', '/api/auth/password', { current, next }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  meta: () =>
    request<{ baseDomain: string; dashboardUrl: string; publicAccess: boolean; globalHook: boolean; github: boolean; domains: string[]; defaultDomain: string | null }>('GET', '/api/meta'),

  listApps: () => request<AppSummary[]>('GET', '/api/apps'),
  getApp: (id: string) => request<AppDetail>('GET', `/api/apps/${id}`),
  createApp: (body: {
    name: string
    slug?: string
    domain?: string
    deployBranch?: string
    previewsEnabled?: boolean
    sourceType: 'image' | 'compose'
    image?: string
    compose?: string
    primaryService?: string
    port: number
  }) => request<AppSummary>('POST', '/api/apps', body),
  updateApp: (id: string, body: Partial<{ name: string; slug: string; domain: string; port: number; compose: string; primaryService: string; deployBranch: string; previewsEnabled: boolean; backupEnabled: boolean }>) =>
    request<AppSummary>('PATCH', `/api/apps/${id}`, body),
  deleteApp: (id: string, removeVolumes: boolean) =>
    request<{ ok: true }>('DELETE', `/api/apps/${id}?volumes=${removeVolumes}`),
  deploy: (id: string) => request<Deployment>('POST', `/api/apps/${id}/deploy`),
  deploymentDiff: (id: string) => request<DeploymentDiff>('GET', `/api/deployments/${id}/diff`),
  previews: (id: string) => request<AppSummary[]>('GET', `/api/apps/${id}/previews`),
  addons: (id: string) => request<AddonInfo[]>('GET', `/api/apps/${id}/addons`),
  addAddon: (id: string, type: AddonType) => request<{ ok: true; envKeys: string[]; note: string }>('POST', `/api/apps/${id}/addons`, { type }),
  removeAddon: (id: string, type: AddonType) => request<{ ok: true; note: string }>('DELETE', `/api/apps/${id}/addons/${type}`),
  hostnames: (id: string) => request<HostnameInfo[]>('GET', `/api/apps/${id}/hostnames`),
  addHostname: (id: string, hostname: string) =>
    request<SetupResult & { hostnames: HostnameInfo[] }>('POST', `/api/apps/${id}/hostnames`, { hostname }),
  removeHostname: (id: string, hostname: string) =>
    request<SetupResult & { hostnames: HostnameInfo[] }>('DELETE', `/api/apps/${id}/hostnames/${encodeURIComponent(hostname)}`),
  backups: () =>
    request<{ settings: BackupSettings; ready: boolean; directory: string; running: boolean; excluded: { id: string; name: string }[]; backups: BackupSummary[] }>('GET', '/api/backups'),
  saveBackupSettings: (body: Partial<BackupSettings>) => request<BackupSettings>('PUT', '/api/backups/settings', body),
  runBackup: () => request<{ id: string }>('POST', '/api/backups/run'),
  backup: (id: string) => request<BackupDetail>('GET', `/api/backups/${id}`),
  deleteBackup: (id: string) => request<{ ok: true }>('DELETE', `/api/backups/${id}`),
  appBackups: (appId: string) => request<AppBackup[]>('GET', `/api/backups/app/${appId}`),
  restoreBackup: (id: string, appId: string) => request<{ ok: boolean; log: string }>('POST', `/api/backups/${id}/restore/${appId}`),
  updateStatus: (refresh = false) => request<UpdateStatus>('GET', `/api/update${refresh ? '?refresh=true' : ''}`),
  applyUpdate: () => request<{ started: true }>('POST', '/api/update'),
  updateLog: () => fetch('/api/update/log', { credentials: 'same-origin' }).then((r) => r.text()),
  action: (id: string, action: 'start' | 'stop' | 'restart') =>
    request<{ ok: true }>('POST', `/api/apps/${id}/actions/${action}`),

  deployments: (id: string) => request<Deployment[]>('GET', `/api/apps/${id}/deployments`),
  deployment: (id: string) => request<Deployment>('GET', `/api/deployments/${id}`),
  rollback: (deploymentId: string) => request<Deployment>('POST', `/api/deployments/${deploymentId}/rollback`),

  getEnv: (id: string) => request<{ vars: EnvVar[] }>('GET', `/api/apps/${id}/env`),
  setEnv: (id: string, vars: EnvVar[]) => request<{ vars: EnvVar[] }>('PUT', `/api/apps/${id}/env`, { vars }),

  getHook: (id: string) => request<{ url: string; secret: string }>('GET', `/api/apps/${id}/hook`),
  rotateHook: (id: string) => request<{ url: string; secret: string }>('POST', `/api/apps/${id}/hook/rotate`),

  stats: (id: string) => request<ContainerStats[]>('GET', `/api/apps/${id}/stats`),

  unusedImages: () => request<{ images: UnusedImage[]; totalBytes: number }>('GET', '/api/images/unused'),
  pruneImages: () => request<{ removed: number; failed: number; bytes: number }>('POST', '/api/images/prune'),

  tokens: () => request<ApiToken[]>('GET', '/api/tokens'),
  createToken: (name: string) => request<ApiToken & { token: string }>('POST', '/api/tokens', { name }),
  rollToken: (id: string) => request<ApiToken & { token: string }>('POST', `/api/tokens/${id}/roll`),
  deleteToken: (id: string) => request<{ ok: true }>('DELETE', `/api/tokens/${id}`),

  globalHook: () => request<GlobalHook>('GET', '/api/global-hook'),
  enableGlobalHook: () => request<GlobalHook>('POST', '/api/global-hook'),
  disableGlobalHook: () => request<GlobalHook>('DELETE', '/api/global-hook'),

  cloudflare: () => request<PublicAccessStatus>('GET', '/api/cloudflare'),
  cloudflareZones: (apiToken: string) => request<{ id: string; name: string }[]>('POST', '/api/cloudflare/zones', { apiToken }),
  cloudflareSetup: (body: { apiToken: string; zoneId: string; replaceDns: boolean; disableBotFightMode: boolean; newTunnel?: boolean }) =>
    request<SetupResult>('POST', '/api/cloudflare/setup', body),
  cloudflareManual: (body: { domain: string; tunnelToken: string }) => request<SetupResult>('POST', '/api/cloudflare/manual', body),
  cloudflareAddDomain: (body: { apiToken?: string; zoneId?: string; domain?: string; replaceDns: boolean }) =>
    request<SetupResult>('POST', '/api/cloudflare/domains', body),
  cloudflareRemoveDomain: (domain: string, apiToken?: string) =>
    request<SetupResult>('DELETE', `/api/cloudflare/domains/${encodeURIComponent(domain)}`, { apiToken }),
  cloudflareSetDefaultDomain: (domain: string) =>
    request<PublicAccessStatus>('POST', `/api/cloudflare/domains/${encodeURIComponent(domain)}/default`),
  cloudflareForgetToken: () => request<PublicAccessStatus>('DELETE', '/api/cloudflare/token'),
  cloudflareDisable: () => request<PublicAccessStatus>('POST', '/api/cloudflare/disable'),
  cloudflareEnable: () => request<SetupResult>('POST', '/api/cloudflare/enable'),
  cloudflareForget: () => request<PublicAccessStatus>('DELETE', '/api/cloudflare'),
  onboarding: () => request<{ pending: boolean }>('GET', '/api/onboarding'),
  completeOnboarding: () => request<{ pending: boolean }>('POST', '/api/onboarding/complete'),

  registries: () => request<RegistryCredential[]>('GET', '/api/registries'),
  saveRegistry: (body: { registry: string; username: string; token: string }) =>
    request<RegistryCredential[]>('PUT', '/api/registries', body),
  removeRegistry: (registry: string) => request<RegistryCredential[]>('DELETE', `/api/registries/${encodeURIComponent(registry)}`),

  github: () => request<GithubStatus>('GET', '/api/github'),
  saveGithub: (token: string) => request<GithubStatus>('PUT', '/api/github', { token }),
  removeGithub: () => request<GithubStatus>('DELETE', '/api/github'),
}
