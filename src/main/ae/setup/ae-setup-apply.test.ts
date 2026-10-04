import { describe, expect, it } from 'vitest'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { Repo } from '../../../shared/repo-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { normalizeAeDomain, type AeDomainConfig } from '../../../shared/ae/domain-types'
import type { AeSetupDetection } from '../../../shared/ae/setup-types'
import { AeDomainService } from '../domain-service'
import { applyAeSetup } from './ae-setup-apply'

/** In-memory persistence: the boundary the domain service and apply write through. */
function memoryStore() {
  const repos: Repo[] = []
  const groups: ProjectGroup[] = []
  const domains: Record<string, AeDomainConfig> = {}
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: apply reads only toolCmdOverrides and aeDbt from settings.
  let settings = { toolCmdOverrides: {} } as unknown as GlobalSettings
  let writes = 0
  const store = {
    getRepos: () => repos,
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getProjectGroups: () => groups,
    createProjectGroup: (input: { name: string; parentPath?: string | null }) => {
      writes++
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: apply and the domain service read only id, name and parentPath.
      const group = {
        id: `group-${groups.length + 1}`,
        name: input.name,
        parentPath: input.parentPath
      } as ProjectGroup
      groups.push(group)
      return group
    },
    moveProjectToGroup: (repoId: string, groupId: string | null) => {
      writes++
      const repo = repos.find((entry) => entry.id === repoId)
      if (!repo) {
        return null
      }
      repo.projectGroupId = groupId ?? undefined
      return repo
    },
    getAeDomain: (id: string) => (domains[id] ? normalizeAeDomain(domains[id], id) : null),
    getAeDomains: () => domains,
    saveAeDomain: (domain: AeDomainConfig) => {
      writes++
      domains[domain.id] = { ...domain, updatedAt: writes }
      return domains[domain.id]
    },
    getSettings: () => settings,
    updateSettings: (updates: Partial<GlobalSettings>) => {
      writes++
      settings = { ...settings, ...updates }
      return settings
    }
  }
  const addRepo = async (path: string): Promise<Repo> => {
    const existing = repos.find((repo) => repo.path === path)
    if (existing) {
      return existing
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: apply reads only id, displayName and projectGroupId.
    const repo = {
      id: `repo-${repos.length + 1}`,
      path,
      displayName: path.split('/').pop()
    } as Repo
    repos.push(repo)
    return repo
  }
  return { store, addRepo, writes: () => writes, domains, settings: () => settings }
}

const detection: AeSetupDetection = {
  dbtRepoPath: '/work/dbt-analytics',
  omniRepoPath: '/work/omni-analytics',
  dbt: {
    binary: '/home/.pyenv/versions/3.11.4/bin/dbt',
    distribution: 'core',
    version: '1.9.4',
    candidates: []
  },
  project: { dir: '/work/dbt-analytics', name: 'analytics', profile: 'mollie' },
  profiles: {
    dir: '/work/dbt-analytics',
    targets: ['saiem_dev', 'prod'],
    defaultTarget: 'saiem_dev'
  },
  target: 'saiem_dev',
  omniRepoIsModel: true,
  omni: {
    binary: '/usr/local/bin/omni',
    version: '0.6.2',
    signIn: 'cli-profile',
    baseUrl: 'https://acme.omniapp.co'
  },
  python: { path: null, sqlglotVersion: null },
  items: []
}

describe('applyAeSetup', () => {
  it('creates the domain with both repos, defaults and tool paths, and a second run changes nothing', async () => {
    const memory = memoryStore()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the domain service and apply call only the methods the memory store has.
    const store = memory.store as unknown as Store
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: saveDomain and getDomain never touch the runtime.
    const domains = new AeDomainService(store, {} as OrcaRuntimeService)
    const deps = { store, domains, addRepo: memory.addRepo }

    const first = await applyAeSetup({ detection }, deps)
    const domain = domains.getDomain(first.domainId)
    expect(first).toMatchObject({ created: true, changed: true })
    expect(domain).toMatchObject({
      name: 'dbt-analytics',
      repos: [
        { repoId: 'repo-1', role: 'dbt' },
        { repoId: 'repo-2', role: 'omni' }
      ],
      env: { OMNI_BASE_URL: 'https://acme.omniapp.co' },
      dbt: { profilesDir: '/work/dbt-analytics', target: 'saiem_dev' }
    })
    expect(memory.settings().toolCmdOverrides).toEqual({
      dbt: '/home/.pyenv/versions/3.11.4/bin/dbt',
      omni: '/usr/local/bin/omni'
    })

    const writesAfterFirst = memory.writes()
    const second = await applyAeSetup({ detection }, deps)
    expect(second).toEqual({ domainId: first.domainId, created: false, changed: false })
    expect(memory.writes()).toBe(writesAfterFirst)
  })
})
