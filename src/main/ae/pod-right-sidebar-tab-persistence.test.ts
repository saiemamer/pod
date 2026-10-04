import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../persistence-test-harness'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}))

describe("Pod's right sidebar tabs in persisted UI state", () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'pod-right-sidebar-tab-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  // Regression: every UI write re-normalised the stored tab against Orca's list, so
  // resizing the right panel with the Database tab open echoed 'explorer' back.
  it.each(['initiative', 'database', 'omni'] as const)(
    'keeps the %s tab through a later width save',
    (tab) => {
      const store = createStore()
      store.updateUI({ rightSidebarTab: tab })
      store.updateUI({ rightSidebarWidth: 420 })
      expect(store.getUI().rightSidebarTab).toBe(tab)
    }
  )
})
