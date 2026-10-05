import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { getDefaultSettings } from '../../shared/constants'
import type { AeDomainConfig } from '../../shared/ae/domain-types'

const mocks = vi.hoisted((): { service: unknown } => ({ service: null }))

vi.mock('./domain-service', () => ({ getAeDomainServiceIfInstalled: () => mocks.service }))
vi.mock('../preflight/agent-detection', () => ({
  detectRemoteAgents: vi.fn(async () => []),
  detectInstalledAgentsWithShellPathHydration: vi.fn(async () => [])
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

import { podDomainAgentEnv, resolvePodAgentStartupPlanInputs } from './domain-agent-env'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  buildWorktreeStartupForAgent,
  buildWorktreeStartupForDraft
} from '../runtime/runtime-worktree-agent-startup'

const domain: AeDomainConfig = {
  id: 'dom-1',
  name: 'Payments',
  repos: [],
  env: { SHARED: 'from-domain', DOMAIN_ONLY: 'd' },
  secretNames: ['WAREHOUSE_TOKEN'],
  dbt: { profilesDir: '/profiles', target: 'dev' },
  stakeholderTeams: [],
  createdAt: 0,
  updatedAt: 0
}

const DOMAIN_REPO_ID = 'repo-in-domain'

function installDomainService(): void {
  mocks.service = {
    roleForRepo: (repoId: string) => (repoId === DOMAIN_REPO_ID ? { domain, role: 'dbt' } : null),
    getDomain: (id: string) => (id === domain.id ? domain : null),
    readSecrets: () => ({ WAREHOUSE_TOKEN: 'secret' }),
    listInitiatives: () => [
      { id: 'init-1', title: 'Refunds', coordinatorWorkspaceKey: 'folder:folder-1' }
    ]
  }
}

const repo = (id: string): Repo => ({
  id,
  path: '/srv/repo',
  displayName: 'repo',
  badgeColor: '#000000',
  addedAt: 0,
  connectionId: null
})

const settings: GlobalSettings = {
  ...getDefaultSettings('/home/test'),
  agentDefaultArgs: {},
  agentDefaultEnv: { claude: { SHARED: 'from-agent', AGENT_ONLY: 'a' } }
}

const launch = { agent: 'claude' as const, platform: 'darwin' as const, isRemote: false, settings }

beforeEach(() => {
  installDomainService()
})

describe('the env Pod layers onto an agent launch', () => {
  it('puts the domain env over the agent defaults and adds the POD_ markers inside a domain', () => {
    const { agentEnv } = resolvePodAgentStartupPlanInputs({ repo: repo(DOMAIN_REPO_ID) }, launch)
    expect(agentEnv).toEqual({
      SHARED: 'from-domain',
      AGENT_ONLY: 'a',
      DOMAIN_ONLY: 'd',
      WAREHOUSE_TOKEN: 'secret',
      POD_DOMAIN_ID: 'dom-1',
      POD_DOMAIN_NAME: 'Payments',
      POD_REPO_ROLE: 'dbt',
      DBT_PROFILES_DIR: '/profiles',
      DBT_TARGET: 'dev'
    })
  })

  it('marks a domain folder workspace with its workspace key and initiative', () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: podDomainAgentEnv reads only id and projectGroupId from a folder workspace.
    const folderWorkspace = { id: 'folder-1', projectGroupId: 'dom-1' } as never
    expect(podDomainAgentEnv({ folderWorkspace })).toMatchObject({
      POD_REPO_ROLE: 'domain',
      POD_WORKSPACE_KEY: 'folder:folder-1',
      POD_INITIATIVE_ID: 'init-1',
      POD_INITIATIVE_TITLE: 'Refunds'
    })
  })

  it('adds nothing outside a domain or before the domain service is installed', () => {
    const agentDefaults = { SHARED: 'from-agent', AGENT_ONLY: 'a' }
    expect(podDomainAgentEnv({ repo: repo('other-repo') })).toEqual({})
    expect(podDomainAgentEnv({})).toEqual({})
    expect(resolvePodAgentStartupPlanInputs({ repo: repo('other-repo') }, launch).agentEnv).toEqual(
      agentDefaults
    )
    mocks.service = null
    expect(podDomainAgentEnv({ repo: repo(DOMAIN_REPO_ID) })).toEqual({})
    expect(
      resolvePodAgentStartupPlanInputs({ repo: repo(DOMAIN_REPO_ID) }, launch).agentEnv
    ).toEqual(agentDefaults)
  })
})

// Why: two of these call sites are ts-nocheck splits of OrcaRuntimeService, so only a test
// notices if one goes back to upstream's resolveAgentStartupPlanInputs and drops the domain env.
describe('every agent launch path carries the domain env', () => {
  const domainMarkers = expect.objectContaining({ POD_DOMAIN_ID: 'dom-1', SHARED: 'from-domain' })

  it('a worktree created with an agent', () => {
    const { startup } = buildWorktreeStartupForAgent({
      repo: repo(DOMAIN_REPO_ID),
      settings,
      agent: 'claude',
      getLaunchPlatform: () => 'darwin',
      toSessionOptions: () => undefined
    })
    expect(startup.env).toEqual(domainMarkers)
  })

  it('a worktree created with a draft prompt', async () => {
    const result = await buildWorktreeStartupForDraft({
      repo: repo(DOMAIN_REPO_ID),
      settings,
      draft: 'fix the refunds model',
      requestedAgent: 'claude',
      getLaunchPlatform: () => 'darwin'
    })
    expect(result?.startup.env).toEqual(domainMarkers)
  })

  function runtimeInDomainRepo(): OrcaRuntimeService {
    const runtime = new OrcaRuntimeService()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: names only the two internals this stub replaces, each assigned before a launch reaches it.
    const internal = runtime as unknown as {
      store: { getSettings: () => unknown }
      resolveTerminalWorkspaceLaunchScope: (selector: string) => Promise<unknown>
    }
    internal.store = { getSettings: () => settings }
    vi.spyOn(internal, 'resolveTerminalWorkspaceLaunchScope').mockResolvedValue({
      id: 'wt-1',
      path: '/srv/repo',
      connectionId: null,
      repo: repo(DOMAIN_REPO_ID),
      folderWorkspace: null
    })
    return runtime
  }

  it('a terminal created with a startup agent', async () => {
    const runtime = runtimeInDomainRepo()
    const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
    runtime.setPtyController({
      spawn,
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    await runtime.createTerminal('id:wt-1', { startupAgent: 'claude' })
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ env: domainMarkers }))
  })

  it('an agent session created over RPC', async () => {
    const runtime = runtimeInDomainRepo()
    const createTerminal = vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
      handle: 'term_1',
      tabId: '11111111-1111-4111-8111-111111111111',
      paneKey: '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222',
      ptyId: 'pty-1',
      worktreeId: 'wt-1',
      title: null,
      surface: 'background'
    })
    await runtime.createAgentSession({
      clientOperationId: `${Date.now()}-0123456789abcdef0123456789abcdef`,
      worktree: 'id:wt-1',
      agent: 'claude',
      prompt: 'fix the refunds model',
      presentation: 'background'
    })
    expect(createTerminal).toHaveBeenCalledWith(
      'id:wt-1',
      expect.objectContaining({ env: domainMarkers })
    )
  })
})
