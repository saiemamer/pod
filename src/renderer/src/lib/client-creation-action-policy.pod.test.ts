import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: brand.ts shows the emulator under vitest so upstream tests pass; this loads the
// policy again as a Pod build sees it. The new-tab menu, its keyboard shortcut, the
// Shortcuts list and the Mobile Emulator settings page all read this policy.
async function loadAsPodBuild() {
  vi.stubEnv('VITEST', 'false')
  vi.resetModules()
  return import('./client-creation-action-policy')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('Mobile Emulator in Pod', () => {
  it('is hidden from the desktop app, so the new-tab menu does not offer it', async () => {
    const policy = await loadAsPodBuild()
    const actions = policy.resolveClientCreationActionPolicy({
      surface: 'electron',
      runtimeStatus: null
    })
    expect(actions['mobile-emulator'].state).toBe('hidden')
    expect(actions['managed-browser'].state).toBe('enabled')
  })
})
