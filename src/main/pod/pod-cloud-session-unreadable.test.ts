import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Pod's key seals as `pod:<value>`; a session sealed with Orca's key does not open.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`pod:${value}`, 'utf8'),
    decryptString: (value: Buffer) => {
      const text = value.toString('utf8')
      if (!text.startsWith('pod:')) {
        throw new Error(
          'Error while decrypting the ciphertext provided to safeStorage.decryptString.'
        )
      }
      return text.slice('pod:'.length)
    }
  }
}))

import {
  getOrcaCloudSessionPath,
  readOrcaCloudSession,
  saveOrcaCloudSession
} from '../orca-profiles/profile-cloud-session-store'

let userDataPath = ''

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'pod-cloud-session-'))
})

afterEach(() => {
  rmSync(userDataPath, { recursive: true, force: true })
})

describe('an Orca account session Pod cannot read', () => {
  it('reads as needing sign-in, keeps the file, and a new sign-in seals with Pod key', () => {
    const path = getOrcaCloudSessionPath('profile-1', userDataPath)
    mkdirSync(join(path, '..'), { recursive: true })
    const sealedByOrca = JSON.stringify({
      version: 1,
      format: 'electron-safe-storage-v1',
      savedAt: 1,
      ciphertext: Buffer.from('orca:{}').toString('base64')
    })
    writeFileSync(path, sealedByOrca)

    expect(readOrcaCloudSession('profile-1', userDataPath)).toMatchObject({
      status: 'decrypt-failed'
    })
    expect(readFileSync(path, 'utf8')).toBe(sealedByOrca)

    const session = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 9_999,
      capabilities: { flags: {}, refreshedAt: 1 }
    }
    expect(saveOrcaCloudSession('profile-1', userDataPath, session)).toBe('encrypted')
    expect(JSON.parse(readFileSync(path, 'utf8')).ciphertext).not.toBe(
      Buffer.from('orca:{}').toString('base64')
    )
  })
})
