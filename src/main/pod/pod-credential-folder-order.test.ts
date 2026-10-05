import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./pod-user-data-copy', () => ({
  copyOrcaUserData: () => {
    throw new Error('disk full')
  }
}))
vi.mock('./pod-user-data-in-use', () => ({
  assertNoAppUsesFolder: () => {},
  stopStalePodDaemon: () => {},
  isPodAppProcess: () => false,
  describeProcessWithPs: () => null
}))

import {
  _resetIntegrationCredentialDirForTests,
  integrationCredentialDir
} from './pod-credential-folder'
import { applyPodUserDataFolder } from './pod-user-data'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-credential-order-'))
  mkdirSync(join(root, 'appData', 'orca'), { recursive: true })
  writeFileSync(join(root, 'appData', 'orca', 'orca-data.json'), '{}\n')
})

afterEach(() => {
  _resetIntegrationCredentialDirForTests()
  rmSync(root, { recursive: true, force: true })
})

describe('a failed data move in packaged Pod', () => {
  it("leaves no store on Orca's ~/.orca once the name seals with Pod's key", () => {
    let name = 'orca'
    const paths = new Map([
      ['appData', join(root, 'appData')],
      ['home', join(root, 'home')]
    ])
    const app = {
      getPath: (key: string) => paths.get(key) ?? '',
      setPath: (key: string, value: string) => void paths.set(key, value),
      getVersion: () => '0.1.15',
      setName: (value: string) => {
        name = value
      }
    }

    expect(() => applyPodUserDataFolder(app)).toThrow('Pod could not copy its data')

    expect(name).toBe('Pod')
    expect(integrationCredentialDir()).toBe(join(root, 'home', '.pod'))
  })
})
