import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Repo } from '../../shared/repo-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { AeDomainConfig, AeInitiative } from '../../shared/ae/domain-types'
import { AeDomainService } from './domain-service'
import { launchAeInitiative } from './initiative-launch'

let root: string
let home: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pod-initiative-launch-')))
  home = join(root, 'home')
  mkdirSync(home)
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

function makeRepo(id: string, name: string, files: string[] = []): Repo {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  for (const file of files) {
    writeFileSync(join(path, file), 'name: demo\n')
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the domain service reads only id, path and projectGroupId.
  return { id, path, displayName: name, projectGroupId: 'g1' } as Repo
}

/** In-memory persistence, the boundary the domain service writes through. */
function memoryStore(group: Partial<ProjectGroup>, repos: Repo[]) {
  const groups = [{ id: 'g1', name: 'Analytics', parentPath: null, ...group }]
  const domains: Record<string, AeDomainConfig> = {}
  let initiatives: AeInitiative[] = []
  const store = {
    getRepos: () => repos,
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getProjectGroups: () => groups,
    getAeDomains: () => domains,
    getAeDomain: (id: string) => domains[id] ?? null,
    saveAeDomain: (domain: AeDomainConfig) => (domains[domain.id] = domain),
    getAeInitiatives: () => initiatives,
    saveAeInitiative: (initiative: AeInitiative) => {
      initiatives = [...initiatives.filter((entry) => entry.id !== initiative.id), initiative]
      return initiative
    },
    removeAeInitiative: (id: string) => {
      initiatives = initiatives.filter((entry) => entry.id !== id)
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the domain service calls only the methods above.
  return store as unknown as Store
}

/** The Orca runtime is the boundary: folder workspaces and agent sessions. */
function fakeRuntime(options: { failSessions: number }) {
  const workspaces = new Set<string>()
  const prompts: string[] = []
  let failuresLeft = options.failSessions
  let next = 0
  const runtime = {
    createFolderWorkspace: async () => {
      const id = `ws-${++next}`
      workspaces.add(id)
      return { id }
    },
    deleteFolderWorkspace: async (id: string) => ({ deleted: workspaces.delete(id) }),
    createAgentSession: async (input: { prompt: string }) => {
      prompts.push(input.prompt)
      if (failuresLeft > 0) {
        failuresLeft--
        throw new Error('pty_spawn_failed')
      }
      return {}
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: launchAeInitiative calls only these three runtime methods.
  return { runtime: runtime as unknown as OrcaRuntimeService, workspaces, prompts }
}

describe('launchAeInitiative', () => {
  it("starts an initiative in a group made without a folder, under Pod's folder in home", async () => {
    const store = memoryStore({}, [makeRepo('r1', 'dbt-repo', ['dbt_project.yml'])])
    const { runtime } = fakeRuntime({ failSessions: 0 })
    const service = new AeDomainService(store, runtime)
    service.saveDomain({ id: 'g1' })

    const preview = service.initiativeFolderPath('g1', 'Pod smoke test')
    const initiative = await launchAeInitiative(service, {
      domainId: 'g1',
      title: 'Pod smoke test'
    })

    expect(initiative.folderPath).toBe(
      join(home, 'Pod', 'analytics', 'initiatives', 'pod-smoke-test')
    )
    expect(preview).toBe(initiative.folderPath)
    expect(existsSync(join(initiative.folderPath, 'INITIATIVE.md'))).toBe(true)
  })

  it('does not put initiatives inside a repo when the group folder is one', async () => {
    const repo = makeRepo('r1', 'dbt-repo', ['dbt_project.yml'])
    const store = memoryStore({ parentPath: repo.path }, [repo])
    const service = new AeDomainService(store, fakeRuntime({ failSessions: 0 }).runtime)
    service.saveDomain({ id: 'g1' })

    expect(service.initiativeFolderPath('g1', 'X')).toBe(
      join(home, 'Pod', 'analytics', 'initiatives', 'x')
    )
  })

  it('names only the ticked repos in INITIATIVE.md and in the drafted prompt', async () => {
    const dbt = makeRepo('r1', 'dbt-demo', ['dbt_project.yml'])
    const omni = makeRepo('r2', 'omni-demo', ['model.yaml'])
    const store = memoryStore({}, [dbt, omni])
    const { runtime, prompts } = fakeRuntime({ failSessions: 0 })
    const service = new AeDomainService(store, runtime)
    service.saveDomain({ id: 'g1' })

    const initiative = await launchAeInitiative(service, {
      domainId: 'g1',
      title: 'Real agent check',
      repoIds: ['r1']
    })

    const markdown = readFileSync(join(initiative.folderPath, 'INITIATIVE.md'), 'utf8')
    const repoSection = markdown.split('## Repos')[1].split('## Goal')[0]
    expect(repoSection.trim()).toBe(`- ${dbt.path} (id: r1, role: dbt)`)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('works in dbt-demo (dbt) only')
    expect(prompts[0]).not.toContain('omni-demo')
  })

  it('leaves no record, workspace or folder after a failed start, and a retry makes one initiative', async () => {
    const store = memoryStore({}, [makeRepo('r1', 'dbt-repo', ['dbt_project.yml'])])
    const { runtime, workspaces } = fakeRuntime({ failSessions: 1 })
    const service = new AeDomainService(store, runtime)
    service.saveDomain({ id: 'g1' })

    await expect(
      launchAeInitiative(service, { domainId: 'g1', title: 'Pod smoke test' })
    ).rejects.toThrow(
      /could not open the main agent for "Pod smoke test" and undid the start \(pty_spawn_failed\)/
    )
    expect(service.listInitiatives()).toEqual([])
    expect(workspaces.size).toBe(0)
    expect(existsSync(join(home, 'Pod'))).toBe(false)

    const initiative = await launchAeInitiative(service, {
      domainId: 'g1',
      title: 'Pod smoke test'
    })
    expect(service.listInitiatives().map((entry) => entry.id)).toEqual([initiative.id])
    expect(initiative.coordinatorWorkspaceKey).toBe('folder:ws-2')
  })
})

describe('AeDomainService repo roles', () => {
  it('detects the role of a repo that joined after the domain was saved, and keeps a hand-set role', () => {
    const omni = makeRepo('r1', 'omni-repo', ['model.yaml'])
    const repos = [omni]
    const store = memoryStore({}, repos)
    const service = new AeDomainService(store, fakeRuntime({ failSessions: 0 }).runtime)
    service.saveDomain({ id: 'g1', repos: [{ repoId: 'r1', role: 'other' }] })

    repos.push(makeRepo('r2', 'dbt-repo', ['dbt_project.yml']))

    expect(service.getDomain('g1')?.repos).toEqual([
      { repoId: 'r1', role: 'other' },
      { repoId: 'r2', role: 'dbt' }
    ])
    expect(service.roleForRepo('r2')?.role).toBe('dbt')
    expect(service.listDomains()[0].repos).toContainEqual({ repoId: 'r2', role: 'dbt' })
  })
})
