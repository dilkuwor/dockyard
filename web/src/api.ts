export type AppState = 'running' | 'partial' | 'stopped' | 'missing'
export type DeploymentStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface Deployment {
  id: string
  status: DeploymentStatus
  trigger: 'create' | 'manual' | 'webhook' | 'rollback'
  image: string | null
  commitSha: string | null
  rollbackOf: string | null
  createdAt: number
  finishedAt: number | null
  log?: string
}

export interface AppSummary {
  id: string
  name: string
  slug: string
  url: string
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
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && path !== '/api/auth/login') {
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
  login: (password: string) => request<{ ok: true }>('POST', '/api/auth/login', { password }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  meta: () => request<{ baseDomain: string; dashboardHost: string }>('GET', '/api/meta'),

  listApps: () => request<AppSummary[]>('GET', '/api/apps'),
  getApp: (id: string) => request<AppDetail>('GET', `/api/apps/${id}`),
  createApp: (body: {
    name: string
    sourceType: 'image' | 'compose'
    image?: string
    compose?: string
    primaryService?: string
    port: number
  }) => request<AppSummary>('POST', '/api/apps', body),
  updateApp: (id: string, body: Partial<{ name: string; port: number; compose: string; primaryService: string }>) =>
    request<AppSummary>('PATCH', `/api/apps/${id}`, body),
  deleteApp: (id: string, removeVolumes: boolean) =>
    request<{ ok: true }>('DELETE', `/api/apps/${id}?volumes=${removeVolumes}`),
  deploy: (id: string) => request<Deployment>('POST', `/api/apps/${id}/deploy`),
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
}
