import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { AeDomainService } from '../domain-service'
import { AeOmniService } from './omni-service'

const STUB = resolve(__dirname, '../../../../docs/pod/smoke/omni-stub.sh')
const MODEL = '11111111-1111-4111-8111-111111111111'

let root: string
let repo: string
let state: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pod-omni-service-')))
  repo = join(root, 'omni-demo')
  state = join(root, 'stub-state')
  mkdirSync(join(repo, 'omni', 'mex'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function fakeRuntime(branch: string): OrcaRuntimeService {
  return {
    showManagedWorktree: async (selector: string) => {
      if (selector === `path:${repo}`) {
        return { id: 'repo-o::wt', repoId: 'repo-o', path: repo, git: { branch } }
      }
      throw new Error('selector_not_found')
    }
  } as unknown as OrcaRuntimeService
}

/**
 * The real domain service over an in-memory store. The key sits in the domain env
 * rather than its secrets because the OS secret store does not exist under vitest;
 * both reach the service through the same merge.
 */
function storeWith(domainEnv: Record<string, string>): Store {
  const domain = {
    id: 'mex',
    name: 'MEX',
    repos: [{ repoId: 'repo-o', role: 'omni' }],
    env: { OMNI_API_KEY: 'key-from-domain', ...domainEnv },
    secretNames: [],
    stakeholderTeams: [],
    createdAt: 0,
    updatedAt: 0
  }
  return {
    getSettings: () => ({ toolCmdOverrides: { omni: STUB } }),
    getAeDomains: () => ({ mex: domain }),
    getAeDomain: (id: string) => (id === 'mex' ? domain : null),
    getRepo: () => null
  } as unknown as Store
}

function makeService(
  options: {
    branch?: string
    domainEnv?: Record<string, string>
    env?: Record<string, string>
  } = {}
): AeOmniService {
  const store = storeWith(
    options.domainEnv ?? { OMNI_MODEL_ID: MODEL, OMNI_BASE_URL: 'https://mex.omniapp.co' }
  )
  const runtime = fakeRuntime(options.branch ?? 'refs/heads/opencx-tickets')
  return new AeOmniService({
    store,
    runtime,
    domains: new AeDomainService(store, runtime),
    env: { PATH: '/usr/bin:/bin', POD_OMNI_STUB_STATE: state, ...options.env }
  })
}

function calls(): string {
  return readFileSync(join(state, 'calls.log'), 'utf8')
}

describe('AeOmniService', () => {
  it('resolves the worktree, domain, model and branch from a path inside the repo', async () => {
    const context = await makeService().context({ path: join(repo, 'omni', 'mex') })
    expect(context).toEqual({
      repoRoot: repo,
      worktree: { id: 'repo-o::wt', repoId: 'repo-o', path: repo },
      domainId: 'mex',
      role: 'omni',
      binary: { path: STUB, source: 'settings' },
      gitBranch: 'opencx-tickets',
      modelId: MODEL,
      modelIdSource: 'domain',
      baseUrl: 'https://mex.omniapp.co',
      tokenEnv: 'OMNI_API_KEY'
    })
    expect(JSON.stringify(context)).not.toContain('key-from-domain')
  })

  it('lets --model beat the domain and the domain beat the environment', async () => {
    const service = makeService({ env: { OMNI_MODEL_ID: 'from-env' } })
    expect(await service.context({ path: repo, modelId: 'from-flag' })).toMatchObject({
      modelId: 'from-flag',
      modelIdSource: 'request'
    })
    expect(await service.context({ path: repo })).toMatchObject({ modelIdSource: 'domain' })
    const envOnly = makeService({ domainEnv: {}, env: { OMNI_MODEL_ID: 'from-env' } })
    expect(await envOnly.context({ path: repo })).toMatchObject({
      modelId: 'from-env',
      modelIdSource: 'environment'
    })
  })

  it('finds no branch, then creates the one named after the git branch', async () => {
    const service = makeService()
    const before = await service.branch({ path: repo })
    expect(before.branch).toBeNull()
    expect(before.branches.map((branch) => branch.name)).toEqual(['someone-else'])
    const created = await service.branch({ path: repo, create: true })
    expect(created).toMatchObject({
      created: true,
      branchName: 'opencx-tickets',
      branch: { name: 'opencx-tickets' }
    })
    const again = await service.branch({ path: repo, create: true })
    expect(again).toMatchObject({ created: false, branch: { id: created.branch?.id } })
    expect(calls()).toContain(`models create-branch ${MODEL} --name opencx-tickets`)
    expect(calls().match(/create-branch/g)).toHaveLength(1)
  })

  it('validates the branch when it exists, else the shared model', async () => {
    const service = makeService()
    const onModel = await service.validate({ path: repo })
    expect(onModel).toMatchObject({ target: 'model', branch: null, valid: true, errors: 0 })
    await service.branch({ path: repo, create: true })
    const onBranch = await service.validate({ path: repo })
    expect(onBranch).toMatchObject({ target: 'branch', valid: false, errors: 1, warnings: 1 })
    expect(onBranch.issues[0]).toMatchObject({ view: 'tickets', field: 'count_by_channel' })
  })

  it('commits the branch and refuses when it does not exist yet', async () => {
    const service = makeService()
    await expect(service.commit({ path: repo, message: 'Add channel' })).rejects.toThrow(
      /orca omni branch --create/
    )
    await service.branch({ path: repo, create: true })
    const result = await service.commit({ path: repo, message: 'Add channel' })
    expect(result).toMatchObject({
      gitSha: '4f2c9e1',
      prUrl: 'https://git.example.invalid/omni-demo/pull/7',
      branch: { name: 'opencx-tickets' }
    })
    expect(calls()).toContain('"commit_message":"Add channel"')
    await expect(service.commit({ path: repo, message: '  ' })).rejects.toThrow(/message/)
  })

  it('lists topics on the branch and reads one', async () => {
    const service = makeService()
    expect((await service.topics({ path: repo })).topics.map((topic) => topic.name)).toEqual([
      'customers',
      'legacy_tickets',
      'tickets'
    ])
    await service.branch({ path: repo, create: true })
    const onBranch = await service.topics({ path: repo })
    expect(onBranch.topics.map((topic) => topic.name)).toContain('ticket_channels')
    const topic = await service.topic({ path: repo, topic: 'tickets' })
    expect(topic.views.map((view) => view.name)).toEqual(['tickets', 'customers'])
    await expect(service.topic({ path: repo, topic: 'missing' })).rejects.toThrow(
      'Omni API 404: Topic missing not found'
    )
  })

  it('explains a missing model id and a detached HEAD', async () => {
    await expect(makeService({ domainEnv: {} }).validate({ path: repo })).rejects.toThrow(
      /OMNI_MODEL_ID/
    )
    await expect(makeService({ branch: '' }).branch({ path: repo })).rejects.toThrow(
      /detached HEAD/
    )
    expect((await makeService({ branch: '' }).validate({ path: repo })).target).toBe('model')
  })
})
