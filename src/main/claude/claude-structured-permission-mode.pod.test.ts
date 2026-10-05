import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: brand.ts keeps Orca's Claude default under vitest so upstream tests pass; this loads
// the module again as a Pod build sees it.
async function loadAsPodBuild() {
  vi.stubEnv('VITEST', 'false')
  vi.resetModules()
  return import('./claude-structured-permission-mode')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('structured Claude sessions in Pod', () => {
  it('leave the permission mode to Claude Code unless the person chose bypass', async () => {
    const structured = await loadAsPodBuild()
    expect(structured.claudeStructuredPermissionModeForSettings({ agentDefaultArgs: {} })).toBe(
      'default'
    )
    expect(
      structured.claudeStructuredPermissionModeForSettings({
        agentDefaultArgs: { claude: '--dangerously-skip-permissions' }
      })
    ).toBe('bypassPermissions')
  })
})
