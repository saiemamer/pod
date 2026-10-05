import { describe, expect, it, vi } from 'vitest'
import type * as brand from '../../../shared/brand'

// Packaged Pod: the flag is false outside vitest.
vi.mock('../../../shared/brand', async (importOriginal) => ({
  ...(await importOriginal<typeof brand>()),
  POD_SHOW_ORCA_CLOUD_FEATURES: false
}))

import { shouldShowUnexpectedSignoutCard } from '../components/unexpected-signout/unexpected-signout-visibility'

describe('the "You\'ve been signed out" card in Pod', () => {
  it('stays hidden when an Orca account session no longer opens', () => {
    expect(
      shouldShowUnexpectedSignoutCard({
        authStatus: {
          activeProfileId: 'profile-1',
          configured: true,
          state: 'reconnect-required',
          persistence: 'none',
          credentialError: 'Could not decrypt saved Orca account session.',
          cloud: {
            cloudProfileId: 'cloud-1',
            userId: 'user-1',
            email: 'person@example.com',
            displayName: 'Person',
            linkedAt: 0
          }
        },
        persistedUIReady: true,
        appVersion: '0.1.15',
        dismissedVersion: null
      })
    ).toBe(false)
  })
})
