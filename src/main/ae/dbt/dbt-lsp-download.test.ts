import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DBT_LSP_VERSION,
  dbtLspAssetFor,
  dbtLspAssetUrl,
  dbtLspBinaryPath,
  ensureDbtLspBinary,
  isDbtLspInstalled,
  pruneOtherDbtLspVersions
} from './dbt-lsp-download'

let userData: string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'pod-lsp-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function fakeAsset(sizeBytes: number, sha256: string): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  const asset = dbtLspAssetFor('darwin', 'x64')
  if (asset) {
    asset.sizeBytes = sizeBytes
    asset.sha256 = sha256
  }
}

const original = { ...dbtLspAssetFor('darwin', 'x64')! }

afterEach(() => {
  const asset = dbtLspAssetFor('darwin', 'x64')!
  asset.sizeBytes = original.sizeBytes
  asset.sha256 = original.sha256
  vi.restoreAllMocks()
})

describe('dbt-language-server download', () => {
  it('names the release asset for each supported platform', () => {
    expect(dbtLspAssetFor('darwin', 'arm64')?.name).toBe('dbt-language-server-darwin-arm64')
    expect(dbtLspAssetFor('darwin', 'x64')?.name).toBe('dbt-language-server-darwin-amd64')
    expect(dbtLspAssetFor('linux', 'x64')?.name).toBe('dbt-language-server-linux-amd64')
    expect(dbtLspAssetFor('win32', 'x64')).toBeNull()
    expect(dbtLspAssetUrl(dbtLspAssetFor('linux', 'x64')!)).toBe(
      `https://github.com/j-clemons/dbt-language-server/releases/download/${DBT_LSP_VERSION}/dbt-language-server-linux-amd64`
    )
  })

  it('downloads once, verifies size and hash, and marks the file executable', async () => {
    const bytes = Buffer.from('#!/bin/sh\necho fake\n')
    fakeAsset(bytes.byteLength, createHash('sha256').update(bytes).digest('hex'))
    const fetch = vi.fn(async () => new Response(bytes, { status: 200 }))
    const file = await ensureDbtLspBinary({ userData, fetch, platform: 'darwin', arch: 'x64' })
    expect(file).toBe(dbtLspBinaryPath(userData))
    expect(statSync(file).mode & 0o111).toBeGreaterThan(0)
    expect(isDbtLspInstalled(userData, 'darwin', 'x64')).toBe(true)
    await ensureDbtLspBinary({ userData, fetch, platform: 'darwin', arch: 'x64' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses a download whose hash does not match and leaves nothing behind', async () => {
    const bytes = Buffer.from('tampered')
    fakeAsset(bytes.byteLength, 'f'.repeat(64))
    const fetch = vi.fn(async () => new Response(bytes, { status: 200 }))
    await expect(
      ensureDbtLspBinary({ userData, fetch, platform: 'darwin', arch: 'x64' })
    ).rejects.toThrow('hash')
    expect(existsSync(dbtLspBinaryPath(userData))).toBe(false)
  })

  it('explains an unsupported platform and a failed request', async () => {
    await expect(
      ensureDbtLspBinary({ userData, fetch: vi.fn(), platform: 'win32', arch: 'x64' })
    ).rejects.toThrow('No dbt-language-server build for win32-x64')
    fakeAsset(3, 'a'.repeat(64))
    await expect(
      ensureDbtLspBinary({
        userData,
        fetch: async () => new Response('', { status: 404 }),
        platform: 'darwin',
        arch: 'x64'
      })
    ).rejects.toThrow('answered 404')
  })

  it('prunes other versions', () => {
    const root = join(userData, 'pod', 'dbt-language-server')
    mkdirSync(join(root, 'v0.3.0'), { recursive: true })
    mkdirSync(join(root, DBT_LSP_VERSION), { recursive: true })
    writeFileSync(join(root, 'v0.3.0', 'dbt-language-server'), 'old')
    expect(pruneOtherDbtLspVersions(userData)).toEqual(['v0.3.0'])
    expect(existsSync(join(root, 'v0.3.0'))).toBe(false)
    expect(existsSync(join(root, DBT_LSP_VERSION))).toBe(true)
  })
})
