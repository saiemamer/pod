import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { Repo } from '../../../shared/repo-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { normalizeAeDomain, type AeDomainConfig } from '../../../shared/ae/domain-types'
import type { AeSetupDetection } from '../../../shared/ae/setup-types'
import { AeDomainService } from '../domain-service'
import { applyAeSetup, setupGroupFolder } from './ae-setup-apply'
import { runAeSetup } from './ae-setup-run'

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
  return { store, addRepo, writes: () => writes, domains, groups, settings: () => settings }
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
  projectDirs: ['/work/dbt-analytics'],
  dbtRepoRole: 'dbt',
  omniRepoRole: 'omni',
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
    const deps = { store, domains, addRepo: memory.addRepo, home: '/home' }

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

const roots: string[] = []
function tempDir(): string {
  // Why realpath: macOS puts tmpdir behind a symlink, and setup resolves paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pod-setup-run-')))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const DBT_CORE = '#!/bin/sh\nprintf "Core:\\n  - installed: 1.9.4\\n"\n'

/** A dbt repo directly in `home`, with a stand-in dbt beside it and nothing on PATH. */
function laptop(defaultTarget: string) {
  const home = tempDir()
  const repo = join(home, 'dbt-analytics')
  mkdirSync(repo)
  writeFileSync(join(repo, 'dbt_project.yml'), 'name: analytics\nprofile: mollie\n')
  writeFileSync(
    join(repo, 'profiles.yml'),
    `mollie:\n  target: ${defaultTarget}\n  outputs:\n    saiem_dev: {type: bigquery}\n    dev: {type: bigquery}\n    prod: {type: bigquery}\n`
  )
  const bin = join(home, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'dbt'), DBT_CORE)
  chmodSync(join(bin, 'dbt'), 0o755)
  const memory = memoryStore()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the domain service and apply call only the methods the memory store has.
  const store = memory.store as unknown as Store
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: saveDomain and getDomain never touch the runtime.
  const domains = new AeDomainService(store, {} as OrcaRuntimeService)
  const deps = {
    probe: { run: runProcess, env: { PATH: [bin, '/bin', '/usr/bin'].join(delimiter) }, home },
    apply: { store, domains, addRepo: memory.addRepo, home }
  }
  return { home, repo, bin, memory, domains, deps }
}

describe('runAeSetup', () => {
  it('detects and applies in one call when nothing needs a decision', async () => {
    const { repo, bin, memory, domains, deps } = laptop('saiem_dev')

    const result = await runAeSetup({ dbtRepoPath: repo }, deps)

    expect(result.questions).toEqual([])
    expect(result.applied).toMatchObject({ created: true, changed: true })
    expect(domains.getDomain(result.applied!.domainId)).toMatchObject({
      repos: [{ repoId: 'repo-1', role: 'dbt' }],
      dbt: { profilesDir: repo, target: 'saiem_dev' }
    })
    expect(memory.settings().toolCmdOverrides).toMatchObject({ dbt: join(bin, 'dbt') })
  })

  it('stops for a choice when the default target looks like production, then applies the pick', async () => {
    const { repo, memory, domains, deps } = laptop('prod')

    const asked = await runAeSetup({ dbtRepoPath: repo }, deps)
    expect(asked.applied).toBeNull()
    expect(asked.questions).toEqual([
      expect.objectContaining({ kind: 'target', options: ['saiem_dev', 'dev', 'prod'] })
    ])
    expect(memory.writes()).toBe(0)

    const answered = await runAeSetup({ dbtRepoPath: repo, target: 'dev' }, deps)
    expect(answered.questions).toEqual([])
    expect(answered.detection.items.find((item) => item.key === 'target')).toMatchObject({
      status: 'found',
      value: 'dev'
    })
    expect(domains.getDomain(answered.applied!.domainId)?.dbt?.target).toBe('dev')
  })

  it('leaves the group without a folder when the repo sits directly in the home folder', async () => {
    const { home, repo, memory, domains, deps } = laptop('dev')

    const result = await runAeSetup({ dbtRepoPath: repo }, deps)

    expect(memory.groups[0]).toMatchObject({ name: 'dbt-analytics', parentPath: null })
    expect(domains.domainFolder(result.applied!.domainId)).toMatch(/[/\\]Pod[/\\]dbt-analytics$/)
    expect(setupGroupFolder(join(home, 'work', 'dbt'), home)).toBe(join(home, 'work'))
    expect(setupGroupFolder(join(dirname(home), 'x'), null)).toBe(dirname(home))
    expect(setupGroupFolder('/dbt', null)).toBeNull()
  })

  it('asks which project when the repo holds two, and keeps the pick as the domain default', async () => {
    const { repo, domains, deps } = laptop('dev')
    for (const name of ['finance', 'marketing']) {
      mkdirSync(join(repo, name))
      writeFileSync(join(repo, name, 'dbt_project.yml'), `name: ${name}\nprofile: mollie\n`)
    }
    rmSync(join(repo, 'dbt_project.yml'))

    const asked = await runAeSetup({ dbtRepoPath: repo }, deps)
    expect(asked.questions.map((question) => question.kind)).toEqual(['project'])

    const projectDir = join(repo, 'marketing')
    const answered = await runAeSetup({ dbtRepoPath: repo, projectDir }, deps)
    expect(domains.getDomain(answered.applied!.domainId)?.dbt).toMatchObject({
      projectDir,
      target: 'dev'
    })
  })
})
