import { beforeEach, describe, expect, it } from 'vitest'
import { setSecretStore } from '../../shared/secret-store'
import {
  PROTECTED_SECRET_SLOT,
  ProtectedSecretPersistence,
  sshPtyOwnerLeaseSecretSlot
} from '../protected-secret-persistence'
import { unreadableSettings } from './pod-unreadable-settings'

// Pod's key seals as `pod:<value>`; anything else was sealed with another key and cannot open.
const POD_PREFIX = 'pod:'
const sealedByOrca = Buffer.from('orca:sealed-under-orca-safe-storage').toString('base64')

beforeEach(() => {
  setSecretStore({
    isEncryptionAvailable: () => true,
    encryptString: (plaintext) => Buffer.from(`${POD_PREFIX}${plaintext}`),
    decryptString: (ciphertext) => {
      const text = ciphertext.toString()
      if (!text.startsWith(POD_PREFIX)) {
        throw new Error(
          'Error while decrypting the ciphertext provided to safeStorage.decryptString.'
        )
      }
      return text.slice(POD_PREFIX.length)
    },
    describeProtectionGap: () => null
  })
})

describe('saved settings Pod cannot read', () => {
  it('lists each setting sealed with another key, and keeps its sealed value', () => {
    const secrets = new ProtectedSecretPersistence()
    const readable = secrets.encrypt(PROTECTED_SECRET_SLOT.httpProxyUrl, 'http://proxy:8080').blob

    const goKey = secrets.decryptWithStatus(PROTECTED_SECRET_SLOT.opencodeGoApiKey, sealedByOrca)
    secrets.decryptWithStatus(PROTECTED_SECRET_SLOT.browserKagiSessionLink, sealedByOrca)
    secrets.decryptWithStatus(sshPtyOwnerLeaseSecretSlot('ssh-1'), sealedByOrca)
    secrets.decryptWithStatus(PROTECTED_SECRET_SLOT.httpProxyUrl, readable)

    expect(goKey).toEqual({ plaintext: '', status: 'failed' })
    expect(unreadableSettings(secrets.unreadableSlots()).sort()).toEqual([
      'browserKagiSessionLink',
      'opencodeGoApiKey'
    ])
    // A save of other settings writes the sealed value back unchanged.
    expect(secrets.encrypt(PROTECTED_SECRET_SLOT.opencodeGoApiKey, '').blob).toBe(sealedByOrca)
  })

  it('stops listing a setting once a new value is saved, and the new value reads back', () => {
    const secrets = new ProtectedSecretPersistence()
    secrets.decryptWithStatus(PROTECTED_SECRET_SLOT.opencodeSessionCookie, sealedByOrca)

    const saved = secrets.encrypt(PROTECTED_SECRET_SLOT.opencodeSessionCookie, 'auth=new')
    // Until the write lands, the sealed value is still the one on disk.
    expect(unreadableSettings(secrets.unreadableSlots())).toEqual(['opencodeSessionCookie'])
    secrets.commitRetentionUpdates(saved.retentionUpdate ? [saved.retentionUpdate] : [])

    expect(unreadableSettings(secrets.unreadableSlots())).toEqual([])
    expect(saved.blob).not.toBe(sealedByOrca)
    expect(
      secrets.decryptWithStatus(PROTECTED_SECRET_SLOT.opencodeSessionCookie, saved.blob)
    ).toEqual({ plaintext: 'auth=new', status: 'decrypted' })
  })
})
