import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../global-settings-types'

// Why: brand.ts keeps Orca's defaults under vitest so upstream tests pass; these load the
// modules again as a Pod build sees them.
async function loadAsPodBuild() {
  vi.stubEnv('VITEST', 'false')
  vi.resetModules()
  return {
    defaults: await import('../tui-agent-launch-defaults.js'),
    pod: await import('./pod-claude-permission-default.js')
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const BYPASS = '--dangerously-skip-permissions'
const MCP_PAIR = "--mcp-config '/Users/a/Library/Application Support/Pod/pod-mcp.json'"

describe('Claude launch arguments in Pod', () => {
  it('starts Claude with no permission argument unless the person set one', async () => {
    const { defaults } = await loadAsPodBuild()
    expect(defaults.resolveTuiAgentLaunchArgs('claude', {})).toBe('')
    expect(defaults.resolveTuiAgentLaunchArgs('claude', undefined)).toBe('')
  })

  it('passes an argument typed in Settings > Agents through unchanged', async () => {
    const { defaults } = await loadAsPodBuild()
    for (const typed of [BYPASS, '--model opus', `${BYPASS} ${MCP_PAIR}`]) {
      expect(defaults.resolveTuiAgentLaunchArgs('claude', { claude: typed })).toBe(typed)
    }
  })

  it("keeps Orca's defaults for the other agents", async () => {
    const { defaults } = await loadAsPodBuild()
    expect(defaults.resolveTuiAgentLaunchArgs('codex', {})).toBe(
      '--dangerously-bypass-approvals-and-sandbox'
    )
  })
})

describe('profiles saved by Pod 0.1.13 and earlier', () => {
  async function migrate(
    settings: Pick<GlobalSettings, 'agentDefaultArgs' | 'podClaudeBypassDefaultCleared'>
  ) {
    const { pod } = await loadAsPodBuild()
    const markNeedsSave = vi.fn()
    const result = pod.podClearSavedClaudeBypassDefault(
      { agentDefaultArgs: settings.agentDefaultArgs },
      settings,
      markNeedsSave
    )
    return { result, saved: markNeedsSave.mock.calls.length > 0 }
  }

  it('drops the saved bypass default once, keeping Pod MCP pair and other agents', async () => {
    const plain = await migrate({ agentDefaultArgs: { claude: BYPASS, codex: '--x' } })
    expect(plain.result).toEqual({
      agentDefaultArgs: { codex: '--x' },
      podClaudeBypassDefaultCleared: true
    })
    expect(plain.saved).toBe(true)

    const withMcp = await migrate({ agentDefaultArgs: { claude: `${BYPASS} ${MCP_PAIR}` } })
    expect(withMcp.result.agentDefaultArgs).toEqual({ claude: MCP_PAIR })
  })

  it("leaves a person's own Claude arguments alone", async () => {
    const own = `${BYPASS} --model opus`
    const { result } = await migrate({ agentDefaultArgs: { claude: own } })
    expect(result.agentDefaultArgs).toEqual({ claude: own })
  })

  it('does not run again after the first load', async () => {
    const { result, saved } = await migrate({
      agentDefaultArgs: { claude: BYPASS },
      podClaudeBypassDefaultCleared: true
    })
    expect(result.agentDefaultArgs).toEqual({ claude: BYPASS })
    expect(saved).toBe(false)
  })
})

describe("onboarding's agent permission toggle in Pod", () => {
  it('writes nothing when left as it opened, and applies a change', async () => {
    const { pod } = await loadAsPodBuild()
    const agentDefaultArgs = { codex: '--dangerously-bypass-approvals-and-sandbox' }
    expect(
      pod.podOnboardingAgentPermissionUpdate({ yoloPermissions: true, agentDefaultArgs })
    ).toEqual({})
    const turnedOff = pod.podOnboardingAgentPermissionUpdate({
      yoloPermissions: false,
      agentDefaultArgs
    })
    expect(turnedOff.agentDefaultArgs?.codex).toBe('')
    const turnedOn = pod.podOnboardingAgentPermissionUpdate({
      yoloPermissions: true,
      agentDefaultArgs: { codex: '' }
    })
    expect(turnedOn.agentDefaultArgs?.claude).toBe(BYPASS)
  })
})
