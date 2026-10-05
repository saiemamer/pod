import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Pod's key seals as `pod:<value>`; a vault sealed with Orca's key does not open.
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

import { PluginSecretsStore } from '../plugins/plugin-secrets-store'

const roots: string[] = []
const sealedByOrca = Buffer.from('orca:plugin-token').toString('base64')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function vaultSealedByOrca(): Promise<{ root: string; vault: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pod-plugin-secrets-'))
  roots.push(root)
  await mkdir(join(root, 'acme.demo'), { recursive: true })
  const vault = join(root, 'acme.demo', 'secrets.json.enc')
  await writeFile(
    vault,
    JSON.stringify({
      version: 1,
      format: 'electron-safe-storage-v1',
      ciphertexts: { token: sealedByOrca, other: sealedByOrca }
    })
  )
  return { root, vault }
}

describe('a plugin secret Pod cannot read', () => {
  it('tells the plugin it could not decrypt, and keeps the sealed value', async () => {
    const { root, vault } = await vaultSealedByOrca()
    const before = await readFile(vault, 'utf8')
    const store = new PluginSecretsStore(root, 'acme.demo')

    expect(store.get('token')).toEqual({ ok: false, error: 'failed to decrypt stored secret' })
    expect(await readFile(vault, 'utf8')).toBe(before)
  })

  it('replaces only the key the plugin saves again, and the new value reads back', async () => {
    const { root, vault } = await vaultSealedByOrca()
    const store = new PluginSecretsStore(root, 'acme.demo')

    expect(store.set('token', 'new-token')).toEqual({ ok: true, value: true })

    expect(store.get('token')).toEqual({ ok: true, value: 'new-token' })
    const written = JSON.parse(await readFile(vault, 'utf8'))
    expect(written.ciphertexts.other).toBe(sealedByOrca)
  })
})
