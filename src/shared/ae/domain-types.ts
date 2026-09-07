/**
 * A Domain is a folder of repos opened and named once (an Orca ProjectGroup) plus what
 * Pod adds: a role per repo, agent env and secret names, dbt defaults, stakeholder teams.
 * Initiatives are pieces of cross-repo work run by the domain's main agent.
 */
export const AE_REPO_ROLES = ['dbt', 'omni', 'other'] as const
export type AeRepoRole = (typeof AE_REPO_ROLES)[number]

export type AeDomainRepo = {
  repoId: string
  role: AeRepoRole
}

export type AeDomainDbtDefaults = {
  profilesDir?: string
  target?: string
  projectDir?: string
}

export type AeDomainConfig = {
  /** The Orca project group id this domain wraps. */
  id: string
  name: string
  repos: AeDomainRepo[]
  defaultAgent?: string
  /** Non-secret env passed to every agent launched in a domain repo or initiative. */
  env: Record<string, string>
  /** Names of secrets kept in the OS secret store under `ae-domain:<id>:<NAME>`. */
  secretNames: string[]
  dbt?: AeDomainDbtDefaults
  /** Stakeholder teams an initiative can be tagged with. */
  stakeholderTeams: string[]
  createdAt: number
  updatedAt: number
}

export const AE_INITIATIVE_STATUSES = ['planning', 'running', 'review', 'done', 'archived'] as const
export type AeInitiativeStatus = (typeof AE_INITIATIVE_STATUSES)[number]

export type AeInitiative = {
  id: string
  domainId: string
  title: string
  slug: string
  stakeholderTeam?: string
  /** `<domain folder>/initiatives/<slug>`; holds INITIATIVE.md and the main agent's notes. */
  folderPath: string
  /** Workspace key of the folder workspace hosting the coordinator terminal (`folder:<id>`). */
  coordinatorWorkspaceKey?: string
  /** Orchestration run id once the coordinator creates it. */
  runId?: string
  repoIds: string[]
  status: AeInitiativeStatus
  createdAt: number
  updatedAt: number
}

export const AE_SECRET_KEY_PREFIX = 'ae-domain'

export function aeDomainSecretKey(domainId: string, name: string): string {
  return `${AE_SECRET_KEY_PREFIX}:${domainId}:${name}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeRepo(value: unknown): AeDomainRepo | null {
  if (!isRecord(value) || typeof value.repoId !== 'string' || value.repoId.length === 0) {
    return null
  }
  const role = AE_REPO_ROLES.includes(value.role as AeRepoRole)
    ? (value.role as AeRepoRole)
    : 'other'
  return { repoId: value.repoId, role }
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }
  const env: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      env[key] = entry
    }
  }
  return env
}

function normalizeDbtDefaults(value: unknown): AeDomainDbtDefaults | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const dbt: AeDomainDbtDefaults = {}
  const profilesDir = optionalString(value.profilesDir)
  const target = optionalString(value.target)
  const projectDir = optionalString(value.projectDir)
  if (profilesDir) {
    dbt.profilesDir = profilesDir
  }
  if (target) {
    dbt.target = target
  }
  if (projectDir) {
    dbt.projectDir = projectDir
  }
  return Object.keys(dbt).length > 0 ? dbt : undefined
}

/** Why tolerant: persisted state written by a newer Pod must still load in an older one. */
export function normalizeAeDomain(value: unknown, fallbackId?: string): AeDomainConfig | null {
  if (!isRecord(value)) {
    return null
  }
  const id = stringOr(value.id, fallbackId ?? '')
  if (id.length === 0) {
    return null
  }
  const now = Date.now()
  const domain: AeDomainConfig = {
    id,
    name: stringOr(value.name, id),
    repos: Array.isArray(value.repos)
      ? value.repos.map(normalizeRepo).filter((repo): repo is AeDomainRepo => repo !== null)
      : [],
    env: normalizeEnv(value.env),
    secretNames: stringArray(value.secretNames),
    stakeholderTeams: stringArray(value.stakeholderTeams),
    createdAt: numberOr(value.createdAt, now),
    updatedAt: numberOr(value.updatedAt, now)
  }
  const defaultAgent = optionalString(value.defaultAgent)
  if (defaultAgent) {
    domain.defaultAgent = defaultAgent
  }
  const dbt = normalizeDbtDefaults(value.dbt)
  if (dbt) {
    domain.dbt = dbt
  }
  return domain
}

export function normalizeAeDomains(value: unknown): Record<string, AeDomainConfig> {
  if (!isRecord(value)) {
    return {}
  }
  const domains: Record<string, AeDomainConfig> = {}
  for (const [key, entry] of Object.entries(value)) {
    const domain = normalizeAeDomain(entry, key)
    if (domain) {
      domains[domain.id] = domain
    }
  }
  return domains
}

export function normalizeAeInitiative(value: unknown): AeInitiative | null {
  if (!isRecord(value)) {
    return null
  }
  const id = optionalString(value.id)
  const domainId = optionalString(value.domainId)
  const folderPath = optionalString(value.folderPath)
  if (!id || !domainId || !folderPath) {
    return null
  }
  const now = Date.now()
  const status = AE_INITIATIVE_STATUSES.includes(value.status as AeInitiativeStatus)
    ? (value.status as AeInitiativeStatus)
    : 'planning'
  const initiative: AeInitiative = {
    id,
    domainId,
    title: stringOr(value.title, id),
    slug: stringOr(value.slug, id),
    folderPath,
    repoIds: stringArray(value.repoIds),
    status,
    createdAt: numberOr(value.createdAt, now),
    updatedAt: numberOr(value.updatedAt, now)
  }
  const stakeholderTeam = optionalString(value.stakeholderTeam)
  if (stakeholderTeam) {
    initiative.stakeholderTeam = stakeholderTeam
  }
  const coordinatorWorkspaceKey = optionalString(value.coordinatorWorkspaceKey)
  if (coordinatorWorkspaceKey) {
    initiative.coordinatorWorkspaceKey = coordinatorWorkspaceKey
  }
  const runId = optionalString(value.runId)
  if (runId) {
    initiative.runId = runId
  }
  return initiative
}

export function normalizeAeInitiatives(value: unknown): AeInitiative[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const initiatives: AeInitiative[] = []
  for (const entry of value) {
    const initiative = normalizeAeInitiative(entry)
    if (initiative && !seen.has(initiative.id)) {
      seen.add(initiative.id)
      initiatives.push(initiative)
    }
  }
  return initiatives
}

/** `OpenCX migration (Support Optimisation)` → `opencx-migration-support-optimisation` */
export function aeInitiativeSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug.length > 0 ? slug : 'initiative'
}
