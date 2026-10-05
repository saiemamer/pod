import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Seals as base64 behind a tag, so a test can tell sealed bytes from the value.
const seal = vi.hoisted(() => ({
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`),
  decryptString: (value: Buffer) =>
    Buffer.from(value.toString('utf8').slice('sealed:'.length), 'base64').toString('utf8')
}))

vi.mock('electron', () => ({ safeStorage: seal }))

let home = ''

/** A fresh module graph, as on the next start, with Pod's folder switched on. */
async function startPod(): Promise<void> {
  vi.resetModules()
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof Os>('node:os')
    return { ...actual, homedir: () => home }
  })
  const { setSecretStore } = await import('../../shared/secret-store')
  setSecretStore({ ...seal, describeProtectionGap: () => null })
  const { setPodCredentialDir } = await import('./pod-credential-folder')
  setPodCredentialDir(join(home, '.pod'))
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pod-credential-stores-'))
})

afterEach(() => {
  vi.doUnmock('node:os')
  rmSync(home, { recursive: true, force: true })
})

describe('with Pod credential folder on, each store writes and reads ~/.pod', () => {
  it.each([
    {
      store: 'Linear',
      file: join('linear-tokens', `${Buffer.from('ws-1').toString('base64url')}.enc`),
      save: async () =>
        (await import('../linear/linear-token-store')).saveWorkspaceToken('ws-1', 'lin_madeup'),
      read: async () =>
        (await import('../linear/linear-token-store')).loadToken({
          force: true,
          workspaceId: 'ws-1'
        }),
      value: 'lin_madeup'
    },
    {
      store: 'Jira',
      file: join('jira-tokens', `${Buffer.from('site-1').toString('base64url')}.enc`),
      save: async () => (await import('../jira/site-credential-store')).saveToken('site-1', 'jt'),
      read: async () => (await import('../jira/site-credential-store')).readToken('site-1'),
      value: 'jt'
    },
    {
      store: 'Bitbucket',
      file: 'bitbucket-credential.enc',
      save: async () =>
        (await import('../bitbucket/credential-store')).saveBitbucketCredential({
          authMode: 'basic',
          email: 'made@up.test',
          baseUrl: null,
          account: null,
          accessToken: null,
          apiToken: 'bb-madeup'
        }),
      read: async () =>
        (await import('../bitbucket/credential-store')).loadStoredBitbucketSecret({ force: true })
          ?.apiToken,
      value: 'bb-madeup'
    },
    {
      store: 'OpenAI speech',
      file: 'openai-speech-token.enc',
      save: async () =>
        (await import('../speech/openai-api-key-store')).saveOpenAiSpeechApiKey('sk-madeup'),
      read: async () => (await import('../speech/openai-api-key-store')).readOpenAiSpeechApiKey(),
      value: 'sk-madeup'
    },
    {
      store: 'MiniMax key',
      file: 'minimax-api-key.enc',
      save: async () =>
        (await import('../minimax/minimax-api-key-store')).saveMiniMaxApiKey('mm-madeup'),
      read: async () => (await import('../minimax/minimax-api-key-store')).readMiniMaxApiKey(),
      value: 'mm-madeup'
    },
    {
      store: 'MiniMax cookie',
      file: 'minimax-session-cookie.enc',
      save: async () =>
        (await import('../minimax/minimax-cookie-store')).saveMiniMaxSessionCookie('sid=madeup'),
      read: async () =>
        (await import('../minimax/minimax-cookie-store')).readMiniMaxSessionCookie(),
      value: 'sid=madeup'
    }
  ])('$store', async ({ file, save, read, value }) => {
    await startPod()
    await save()

    expect(existsSync(join(home, '.pod', file))).toBe(true)
    expect(existsSync(join(home, '.orca'))).toBe(false)

    await startPod()
    expect(await read()).toBe(value)
  })
})
