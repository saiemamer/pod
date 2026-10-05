import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: brand.ts keeps Orca's defaults under vitest; this loads the module as a Pod build sees it.
async function loadAsPodBuild() {
  vi.stubEnv('VITEST', 'false')
  vi.resetModules()
  return import('./domain-agent-env')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const BYPASS = '--dangerously-skip-permissions'
const launch = { agent: 'claude' as const, platform: 'darwin' as const, isRemote: false }

describe('Claude launch arguments by kind of session in Pod', () => {
  it('gives an orchestration worker the bypass flag', async () => {
    const { resolvePodAgentStartupPlanInputs } = await loadAsPodBuild()
    const inputs = resolvePodAgentStartupPlanInputs(
      { launchSource: 'orchestration' },
      { ...launch, settings: {} }
    )
    expect(inputs.agentArgs).toBe(BYPASS)
  })

  it('gives an interactive session and an initiative main agent no permission argument', async () => {
    const { resolvePodAgentStartupPlanInputs } = await loadAsPodBuild()
    expect(resolvePodAgentStartupPlanInputs({}, { ...launch, settings: {} }).agentArgs).toBe('')
    expect(
      resolvePodAgentStartupPlanInputs({ launchSource: 'sidebar' }, { ...launch, settings: {} })
        .agentArgs
    ).toBe('')
  })

  it('uses Settings > Agents arguments unchanged for every kind of session', async () => {
    const { resolvePodAgentStartupPlanInputs } = await loadAsPodBuild()
    const settings = { agentDefaultArgs: { claude: '--permission-mode acceptEdits' } }
    for (const launchSource of [undefined, 'sidebar', 'orchestration']) {
      expect(
        resolvePodAgentStartupPlanInputs({ launchSource }, { ...launch, settings }).agentArgs
      ).toBe('--permission-mode acceptEdits')
    }
    const model = { agentDefaultArgs: { claude: '--model opus' } }
    expect(resolvePodAgentStartupPlanInputs({}, { ...launch, settings: model }).agentArgs).toBe(
      '--model opus'
    )
    expect(
      resolvePodAgentStartupPlanInputs(
        { launchSource: 'orchestration' },
        { ...launch, settings: model }
      ).agentArgs
    ).toBe(`${BYPASS} --model opus`)
  })
})
