import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { Repo } from '../../shared/repo-types'
import type { AeDomainConfig, AeRepoRole } from '../../shared/ae/domain-types'
import { getAeDomainServiceIfInstalled } from './domain-service'

export type AeAgentLaunchScope = {
  repo?: Repo | null
  folderWorkspace?: FolderWorkspace | null
}

/**
 * Env every agent launched inside a domain receives: the domain's env, its decrypted
 * secrets, dbt defaults, and POD_* markers so skills know which repo role they are in.
 * Returns {} outside a domain, so upstream launches are unchanged.
 */
export function podDomainAgentEnv(scope: AeAgentLaunchScope): Record<string, string> {
  const service = getAeDomainServiceIfInstalled()
  if (!service) {
    return {}
  }
  let domain: AeDomainConfig | null = null
  let role: AeRepoRole | 'domain' = 'domain'
  if (scope.repo) {
    const match = service.roleForRepo(scope.repo.id)
    if (match) {
      domain = match.domain
      role = match.role
    }
  } else if (scope.folderWorkspace) {
    domain = service.getDomain(scope.folderWorkspace.projectGroupId)
  }
  if (!domain) {
    return {}
  }
  const env: Record<string, string> = {
    ...domain.env,
    ...service.readSecrets(domain.id),
    POD_DOMAIN_ID: domain.id,
    POD_DOMAIN_NAME: domain.name,
    POD_REPO_ROLE: role
  }
  if (scope.folderWorkspace) {
    // Why: the main agent passes this as --parent-worktree when it creates worker worktrees.
    const workspaceKey = `folder:${scope.folderWorkspace.id}`
    env.POD_WORKSPACE_KEY = workspaceKey
    const initiative = service
      .listInitiatives(domain.id)
      .find((entry) => entry.coordinatorWorkspaceKey === workspaceKey)
    if (initiative) {
      env.POD_INITIATIVE_ID = initiative.id
      env.POD_INITIATIVE_TITLE = initiative.title
    }
  }
  if (domain.dbt?.profilesDir) {
    env.DBT_PROFILES_DIR = domain.dbt.profilesDir
  }
  if (domain.dbt?.target) {
    env.DBT_TARGET = domain.dbt.target
  }
  return env
}
