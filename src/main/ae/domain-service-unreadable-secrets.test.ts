import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { AeDomainConfig } from '../../shared/ae/domain-types'
import { setSecretStore } from '../../shared/secret-store'
import { AeDomainService } from './domain-service'

// Pod's key reads only what it sealed; anything else stands for a value sealed under "orca Safe Storage".
const podKey = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`pod:${value}`),
  decryptString: (value: Buffer) => {
    const text = value.toString('utf8')
    if (!text.startsWith('pod:')) {
      throw new Error(
        'Error while decrypting the ciphertext provided to safeStorage.decryptString.'
      )
    }
    return text.slice('pod:'.length)
  },
  describeProtectionGap: () => null
}

function memoryStore() {
  const domain = { id: 'g1', secretNames: ['OMNI_API_KEY', 'SNOWFLAKE_PASSWORD'] }
  const ciphers = new Map([
    ['OMNI_API_KEY', Buffer.from('orca-sealed bytes').toString('base64')],
    ['SNOWFLAKE_PASSWORD', Buffer.from('pod:pw-madeup').toString('base64')]
  ])
  const store = {
    getAeDomain: () => domain,
    saveAeDomain: (next: Partial<AeDomainConfig>) => Object.assign(domain, next),
    getAeDomainSecretCipher: (_id: string, name: string) => ciphers.get(name),
    setAeDomainSecret: (_id: string, name: string, cipher: string) => void ciphers.set(name, cipher)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the secret methods call only these four store methods.
  return { store: store as unknown as Store, ciphers }
}

function makeService(store: Store): AeDomainService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the secret methods never touch the runtime.
  return new AeDomainService(store, {} as OrcaRuntimeService)
}

beforeEach(() => {
  setSecretStore(podKey)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a domain secret Pod cannot read', () => {
  it('is named for Domain settings and in the launch log, and the sealed value is kept', () => {
    const { store, ciphers } = memoryStore()
    const service = makeService(store)
    const before = ciphers.get('OMNI_API_KEY')

    expect(service.unreadableSecretNames('g1')).toEqual(['OMNI_API_KEY'])
    expect(service.readSecrets('g1')).toEqual({ SNOWFLAKE_PASSWORD: 'pw-madeup' })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('OMNI_API_KEY'))
    expect(ciphers.get('OMNI_API_KEY')).toBe(before)
  })

  it('reads back once the person enters it again', () => {
    const { store, ciphers } = memoryStore()
    const service = makeService(store)

    service.setSecret('g1', 'OMNI_API_KEY', 'omni-madeup')

    expect(Buffer.from(ciphers.get('OMNI_API_KEY') ?? '', 'base64').toString()).toBe(
      'pod:omni-madeup'
    )
    expect(service.unreadableSecretNames('g1')).toEqual([])
    expect(service.readSecrets('g1')).toEqual({
      OMNI_API_KEY: 'omni-madeup',
      SNOWFLAKE_PASSWORD: 'pw-madeup'
    })
  })
})
