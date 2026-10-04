import { dirname } from 'node:path'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import type { AeDomainConfig, AeDomainRepo } from '../../../shared/ae/domain-types'
import {
  normalizeAeDbtSettings,
  normalizeAeToolCmdOverrides
} from '../../../shared/ae/dbt-settings-types'
import type { AeSetupApplyRequest, AeSetupApplyResult } from '../../../shared/ae/setup-types'
import type { AeDomainService } from '../domain-service'

export type AeSetupApplyDeps = {
  store: Pick<
    Store,
    | 'getProjectGroups'
    | 'createProjectGroup'
    | 'moveProjectToGroup'
    | 'getSettings'
    | 'updateSettings'
  >
  domains: Pick<AeDomainService, 'getDomain' | 'saveDomain'>
  /** Registers the folder as a project, or returns the one already registered there. */
  addRepo: (path: string) => Promise<Repo>
}

/**
 * Pod: one action from a setup detection to a working domain. Every write is skipped when
 * the stored value already matches, so a second run changes nothing.
 */
export async function applyAeSetup(
  request: AeSetupApplyRequest,
  deps: AeSetupApplyDeps
): Promise<AeSetupApplyResult> {
  const { detection } = request
  const dbtRepo = await deps.addRepo(detection.dbtRepoPath)
  const omniRepo = detection.omniRepoPath ? await deps.addRepo(detection.omniRepoPath) : null
  let changed = false

  const groups = deps.store.getProjectGroups()
  let group = groups.find((entry) => entry.id === dbtRepo.projectGroupId)
  const created = !group
  if (!group) {
    group = deps.store.createProjectGroup({
      name: dbtRepo.displayName,
      parentPath: dirname(detection.dbtRepoPath),
      createdFrom: 'manual'
    })
    changed = true
  }
  for (const repo of [dbtRepo, omniRepo]) {
    if (repo && repo.projectGroupId !== group.id) {
      deps.store.moveProjectToGroup(repo.id, group.id)
      changed = true
    }
  }

  const existing = deps.domains.getDomain(group.id)
  const repos = withRole(withRole(existing?.repos ?? [], dbtRepo.id, 'dbt'), omniRepo?.id, 'omni')
  const env = { ...existing?.env }
  if (detection.omni.baseUrl && !env.OMNI_BASE_URL) {
    env.OMNI_BASE_URL = detection.omni.baseUrl
  }
  const dbt = { ...existing?.dbt }
  if (detection.profiles.dir) {
    dbt.profilesDir = detection.profiles.dir
  }
  const target = request.target?.trim() || detection.target
  if (target) {
    dbt.target = target
  }
  const next: Partial<AeDomainConfig> & { id: string } = {
    id: group.id,
    name: existing?.name ?? group.name,
    repos,
    env,
    dbt
  }
  if (!existing || domainDiffers(existing, next)) {
    deps.domains.saveDomain(next)
    changed = true
  }

  if (applyToolSettings(request, deps)) {
    changed = true
  }
  return { domainId: group.id, created, changed }
}

function withRole(
  repos: AeDomainRepo[],
  repoId: string | undefined,
  role: AeDomainRepo['role']
): AeDomainRepo[] {
  if (!repoId) {
    return repos
  }
  const others = repos.filter((entry) => entry.repoId !== repoId)
  const current = repos.find((entry) => entry.repoId === repoId)
  return current?.role === role ? repos : [...others, { repoId, role }]
}

function domainDiffers(existing: AeDomainConfig, next: Partial<AeDomainConfig>): boolean {
  return (
    existing.name !== next.name ||
    JSON.stringify(existing.repos) !== JSON.stringify(next.repos) ||
    JSON.stringify(existing.env) !== JSON.stringify(next.env) ||
    JSON.stringify(existing.dbt ?? {}) !== JSON.stringify(next.dbt ?? {})
  )
}

/** Tool paths and dbt's distribution are app-wide settings; write only what detection found and what differs. */
function applyToolSettings(request: AeSetupApplyRequest, deps: AeSetupApplyDeps): boolean {
  const { detection } = request
  const settings = deps.store.getSettings()
  const overrides = normalizeAeToolCmdOverrides(settings.toolCmdOverrides)
  const nextOverrides: Record<string, string> = { ...settings.toolCmdOverrides }
  const found = {
    dbt: detection.dbt.binary,
    omni: detection.omni.binary,
    python: detection.python.path
  }
  let overridesChanged = false
  for (const tool of ['dbt', 'omni', 'python'] as const) {
    const value = found[tool]
    if (value && overrides[tool] !== value) {
      nextOverrides[tool] = value
      overridesChanged = true
    }
  }
  const aeDbt = normalizeAeDbtSettings(settings.aeDbt)
  const distribution = detection.dbt.distribution
  const distributionChanged = distribution !== null && aeDbt.distribution !== distribution
  if (!overridesChanged && !distributionChanged) {
    return false
  }
  deps.store.updateSettings({
    ...(overridesChanged ? { toolCmdOverrides: nextOverrides } : {}),
    ...(distributionChanged && distribution ? { aeDbt: { ...aeDbt, distribution } } : {})
  })
  return true
}
