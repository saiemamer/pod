import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { omniCliConfigPath, readOmniCliProfile } from './omni-cli-sign-in'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pod-omni-sign-in-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function writeConfig(doc: unknown): void {
  mkdirSync(join(home, '.config', 'omni-cli'), { recursive: true })
  writeFileSync(join(home, '.config', 'omni-cli', 'config.json'), JSON.stringify(doc))
}

describe('omniCliConfigPath', () => {
  it('follows the CLI: OMNI_CONFIG_PATH, OMNI_CONFIG_DIR, XDG_CONFIG_HOME, then ~/.config on macOS', () => {
    expect(omniCliConfigPath({}, '/Users/a', 'darwin')).toBe(
      join('/Users/a', '.config', 'omni-cli', 'config.json')
    )
    expect(omniCliConfigPath({ XDG_CONFIG_HOME: '/x' }, '/Users/a', 'darwin')).toBe(
      join('/x', 'omni-cli', 'config.json')
    )
    expect(
      omniCliConfigPath({ XDG_CONFIG_HOME: '/x', OMNI_CONFIG_DIR: '/d' }, '/Users/a', 'darwin')
    ).toBe(join('/d', 'config.json'))
    expect(
      omniCliConfigPath(
        { OMNI_CONFIG_DIR: '/d', OMNI_CONFIG_PATH: '/p.json' },
        '/Users/a',
        'darwin'
      )
    ).toBe('/p.json')
    expect(omniCliConfigPath({ APPDATA: 'C:\\AppData' }, null, 'win32')).toBe(
      join('C:\\AppData', 'omni-cli', 'config.json')
    )
  })
})

describe('readOmniCliProfile', () => {
  it('finds no sign-in without a config file, or in one without a default profile', () => {
    expect(readOmniCliProfile({}, home, 'darwin')).toBeNull()
    writeConfig({})
    expect(readOmniCliProfile({}, home, 'darwin')?.signedIn).toBe(false)
  })

  it('counts an API-key profile and an OAuth profile from `omni config login`', () => {
    writeConfig({
      version: 1,
      defaultProfile: 'work',
      profiles: {
        work: { apiEndpoint: 'https://acme.omniapp.co', authMethod: 'api-key', apiKey: 'k' }
      }
    })
    expect(readOmniCliProfile({}, home, 'darwin')).toEqual({
      path: join(home, '.config', 'omni-cli', 'config.json'),
      profile: 'work',
      signedIn: true,
      apiEndpoint: 'https://acme.omniapp.co'
    })
    writeConfig({
      defaultProfile: 'work',
      profiles: { work: { authMethod: 'oauth', accessToken: 't', refreshToken: 'r' } }
    })
    expect(readOmniCliProfile({}, home, 'darwin')?.signedIn).toBe(true)
  })

  it('does not count an OAuth profile after `omni config logout`, which clears its tokens', () => {
    writeConfig({
      defaultProfile: 'work',
      profiles: { work: { authMethod: 'oauth', apiKey: 'left-over' } }
    })
    expect(readOmniCliProfile({}, home, 'darwin')?.signedIn).toBe(false)
  })
})
