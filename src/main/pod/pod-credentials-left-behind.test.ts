import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { credentialsLeftBehind } from './pod-credentials-left-behind'

let pod: string

beforeEach(() => {
  pod = mkdtempSync(join(tmpdir(), 'pod-left-behind-'))
})

afterEach(() => {
  rmSync(pod, { recursive: true, force: true })
})

function writeMarker(leftSealed: string[]): void {
  writeFileSync(
    join(pod, 'pod-credentials-origin.json'),
    JSON.stringify({ copied: [], leftSealed })
  )
}

function writeToken(relativePath: string): void {
  mkdirSync(join(pod, relativePath, '..'), { recursive: true })
  writeFileSync(join(pod, relativePath), 'made-up sealed bytes')
}

describe('credentials the first start left in ~/.orca', () => {
  it('names each service with a sealed file left behind', () => {
    writeMarker([
      join('linear-tokens', 'd3MtMQ.enc'),
      join('jira-tokens', 'c2l0ZQ.enc'),
      'bitbucket-credential.enc',
      'openai-speech-token.enc',
      'minimax-session-cookie.enc'
    ])

    expect(credentialsLeftBehind(pod)).toEqual([
      'linear',
      'jira',
      'bitbucket',
      'openai-speech',
      'minimax'
    ])
  })

  it('drops a service once Pod holds a new credential for it', () => {
    writeMarker([
      'linear-token.enc',
      join('jira-tokens', 'old-site.enc'),
      'minimax-api-key.enc',
      'minimax-session-cookie.enc'
    ])
    writeToken(join('linear-tokens', 'new-workspace.enc'))
    writeToken(join('jira-tokens', 'new-site.enc'))
    writeToken('minimax-api-key.enc')

    // The MiniMax cookie is a second credential, still missing.
    expect(credentialsLeftBehind(pod)).toEqual(['minimax'])
  })

  it('asks for nothing without a marker, as in a development build or a fresh Pod', () => {
    expect(credentialsLeftBehind(pod)).toEqual([])
    writeFileSync(join(pod, 'pod-credentials-origin.json'), 'not json')
    expect(credentialsLeftBehind(pod)).toEqual([])
  })
})
