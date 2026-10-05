import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyPodCredentialFolder,
  copyOrcaCredentialsOnce,
  isSealedCredentialFile
} from './pod-credential-copy'
import {
  _resetIntegrationCredentialDirForTests,
  integrationCredentialDir
} from './pod-credential-folder'

// A macOS safeStorage blob starts with `v10` and continues as AES bytes.
const SEALED = Buffer.concat([
  Buffer.from('v10'),
  Buffer.from([0x8f, 0x01, 0xc3, 0x28, 0xff, 0x00])
])
const minimaxEnvelope = (kind: 'encrypted' | 'plaintext', value: Buffer): string =>
  `orca-minimax-api-key:v1:${kind}:${value.toString('base64')}`

const PLAIN_FILES: Record<string, string | Buffer> = {
  'linear-workspaces.json': '{"version":1,"workspaces":[]}\n',
  'linear-viewer.json': '{"name":"Made Up"}\n',
  'jira-sites.json': '{"version":1,"sites":[]}\n',
  'bitbucket-credential.json': '{"version":1,"authMode":"basic"}\n',
  'linear-tokens/d3M.enc': 'lin_api_madeup',
  'minimax-api-key.enc': minimaxEnvelope('plaintext', Buffer.from('mm-madeup'))
}
const SEALED_FILES: Record<string, string | Buffer> = {
  'linear-token.enc': SEALED,
  'jira-tokens/c2l0ZQ.enc': SEALED,
  'bitbucket-credential.enc': SEALED,
  'openai-speech-token.enc': '{"encryptedKeyBase64":"djEwAAAA"}',
  'minimax-session-cookie.enc': `orca-minimax-cookie:v1:encrypted:${SEALED.toString('base64')}`
}
const NOT_CREDENTIALS: Record<string, string> = {
  'keybindings.json': '{}\n',
  'agent-hooks/claude-hook.sh': '#!/bin/sh\n',
  'linear-tokens/notes.txt': 'not a token'
}

let root: string
let home: string
let orca: string
let pod: string

function write(folder: string, files: Record<string, string | Buffer>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true })
    writeFileSync(join(folder, path), content)
  }
}

/** Every file under `folder` with its bytes and mtime, so any change shows. */
function snapshot(folder: string): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else {
        result[relative(folder, path)] =
          `${readFileSync(path).toString('base64')}@${statSync(path).mtimeMs}`
      }
    }
  }
  walk(folder)
  return result
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-credentials-'))
  home = join(root, 'home')
  orca = join(home, '.orca')
  pod = join(home, '.pod')
  write(orca, { ...PLAIN_FILES, ...SEALED_FILES, ...NOT_CREDENTIALS })
})

afterEach(() => {
  _resetIntegrationCredentialDirForTests()
  rmSync(root, { recursive: true, force: true })
})

describe('copyOrcaCredentialsOnce', () => {
  it('copies the plain credential files and leaves the sealed ones behind', () => {
    const result = copyOrcaCredentialsOnce({ sourceDir: orca, targetDir: pod })

    expect(result).toEqual({
      kind: 'copied',
      copied: expect.arrayContaining(Object.keys(PLAIN_FILES)),
      leftSealed: expect.arrayContaining(Object.keys(SEALED_FILES))
    })
    for (const [path, content] of Object.entries(PLAIN_FILES)) {
      expect(readFileSync(join(pod, path))).toEqual(Buffer.from(content))
      expect(statSync(join(pod, path)).mode & 0o777).toBe(0o600)
    }
    for (const path of [...Object.keys(SEALED_FILES), ...Object.keys(NOT_CREDENTIALS)]) {
      expect(existsSync(join(pod, path))).toBe(false)
    }
    const marker = JSON.parse(readFileSync(join(pod, 'pod-credentials-origin.json'), 'utf8'))
    expect(marker.leftSealed.sort()).toEqual(Object.keys(SEALED_FILES).sort())
  })

  it('changes nothing in ~/.orca', () => {
    const before = snapshot(orca)

    copyOrcaCredentialsOnce({ sourceDir: orca, targetDir: pod })

    expect(snapshot(orca)).toEqual(before)
  })

  it('does nothing on the second run, even when ~/.orca has changed since', () => {
    copyOrcaCredentialsOnce({ sourceDir: orca, targetDir: pod })
    writeFileSync(join(pod, 'linear-viewer.json'), '{"name":"Saved by Pod"}\n')
    writeFileSync(join(orca, 'jira-tokens', 'bmV3.enc'), 'jira-later')
    const before = snapshot(pod)

    expect(copyOrcaCredentialsOnce({ sourceDir: orca, targetDir: pod })).toEqual({
      kind: 'already-copied'
    })
    expect(snapshot(pod)).toEqual(before)
  })

  it('finishes an interrupted copy without overwriting what is already there', () => {
    write(pod, {
      'jira-sites.json': '{"saved":"by Pod"}\n',
      'linear-tokens/d3M.enc.4242.pod-copying': 'half a fil'
    })

    const result = copyOrcaCredentialsOnce({ sourceDir: orca, targetDir: pod })

    expect(result.kind === 'copied' && result.copied).not.toContain('jira-sites.json')
    expect(readFileSync(join(pod, 'jira-sites.json'), 'utf8')).toBe('{"saved":"by Pod"}\n')
    expect(readFileSync(join(pod, 'linear-tokens', 'd3M.enc'), 'utf8')).toBe('lin_api_madeup')
    expect(readdirSync(join(pod, 'linear-tokens'))).toEqual(['d3M.enc'])
  })

  it('runs once on a Mac without ~/.orca', () => {
    rmSync(orca, { recursive: true })

    expect(copyOrcaCredentialsOnce({ sourceDir: orca, targetDir: pod })).toEqual({
      kind: 'copied',
      copied: [],
      leftSealed: []
    })
    expect(copyOrcaCredentialsOnce({ sourceDir: orca, targetDir: pod }).kind).toBe('already-copied')
  })
})

describe('isSealedCredentialFile', () => {
  it('reads the MiniMax envelope instead of guessing', () => {
    expect(isSealedCredentialFile(Buffer.from(minimaxEnvelope('encrypted', SEALED)))).toBe(true)
    expect(isSealedCredentialFile(Buffer.from(minimaxEnvelope('plaintext', SEALED)))).toBe(false)
  })

  it('treats a bare token as plain and safeStorage bytes as sealed', () => {
    expect(isSealedCredentialFile(Buffer.from('ATATT3x-madeup'))).toBe(false)
    expect(isSealedCredentialFile(SEALED)).toBe(true)
  })
})

describe('applyPodCredentialFolder', () => {
  it('points the credential stores at ~/.pod after the copy', () => {
    expect(integrationCredentialDir()).not.toBe(pod)

    applyPodCredentialFolder(home)

    expect(integrationCredentialDir()).toBe(pod)
    expect(existsSync(join(pod, 'pod-credentials-origin.json'))).toBe(true)
  })

  it('still points at ~/.pod when the copy fails', () => {
    writeFileSync(join(home, '.pod'), 'a file where the folder should be')

    applyPodCredentialFolder(home)

    expect(integrationCredentialDir()).toBe(pod)
  })
})
