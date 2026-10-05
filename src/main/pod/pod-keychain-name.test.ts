import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stands in for Electron's `app`: the name starts from package.json and userData defaults to
// `<appData>/<name>` until something sets it, as in Electron.
const electron = vi.hoisted(() => ({ name: '', paths: new Map<string, string>() }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      electron.paths.get(name) ??
      (name === 'userData' ? `${electron.paths.get('appData')}/${electron.name}` : ''),
    setPath: (name: string, value: string) => {
      electron.paths.set(name, value)
    },
    getName: () => electron.name,
    setName: (name: string) => {
      electron.name = name
    },
    getVersion: () => '0.1.15',
    isPackaged: true,
    quit: vi.fn(),
    exit: vi.fn(),
    commandLine: { appendSwitch: vi.fn(), getSwitchValue: vi.fn(() => '') }
  }
}))

import { app } from 'electron'
import { setAppEnvironment } from '../../shared/app-environment'
import { ElectronAppEnvironment } from '../host/electron-app-environment'
import {
  getCanonicalUserDataPath,
  getDataFile,
  initDataPath
} from '../persistence/loading-store/user-data-path'
import {
  configureDevUserDataPath,
  configureOrcaUserDataPathEnv
} from '../startup/configure-process'
import {
  getDevInstanceIdentity,
  shouldApplyPreReadyAppName
} from '../startup/dev-instance-identity'
import {
  _resetIntegrationCredentialDirForTests,
  integrationCredentialDir
} from './pod-credential-folder'

const packageJson: { name: string; productName?: string } = JSON.parse(
  readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')
)
const savedEnv = {
  e2e: process.env.ORCA_E2E_USER_DATA_DIR,
  dev: process.env.ORCA_DEV_USER_DATA_PATH,
  userData: process.env.ORCA_USER_DATA_PATH
}

let root: string
let appData: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-keychain-'))
  appData = join(root, 'Application Support')
  mkdirSync(appData, { recursive: true })
  // Electron's own init names the app from package.json before any app code runs.
  electron.name = packageJson.productName ?? packageJson.name
  electron.paths = new Map([
    ['appData', appData],
    ['home', join(root, 'home')]
  ])
  delete process.env.ORCA_E2E_USER_DATA_DIR
  delete process.env.ORCA_DEV_USER_DATA_PATH
})

afterEach(() => {
  _resetIntegrationCredentialDirForTests()
  rmSync(root, { recursive: true, force: true })
  for (const [key, value] of [
    ['ORCA_E2E_USER_DATA_DIR', savedEnv.e2e],
    ['ORCA_DEV_USER_DATA_PATH', savedEnv.dev],
    ['ORCA_USER_DATA_PATH', savedEnv.userData]
  ] as const) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

/** The steps of main-process-preflight.ts up to its pre-ready rename, in its order. */
function startUntilKeychainNameIsFixed(isDev: boolean): void {
  configureDevUserDataPath(isDev)
  configureOrcaUserDataPathEnv()
  setAppEnvironment(new ElectronAppEnvironment())
  initDataPath()
  const identity = getDevInstanceIdentity(isDev, {})
  if (shouldApplyPreReadyAppName(identity)) {
    app.setName(identity.appName)
  }
}

describe('the app name when Electron fixes the Keychain item name', () => {
  it('is Pod for packaged Pod, so the item is "Pod Safe Storage"', () => {
    startUntilKeychainNameIsFixed(false)

    expect(app.getName()).toBe('Pod')
  })

  it('stays "Orca Dev" for a development build', () => {
    startUntilKeychainNameIsFixed(true)

    expect(app.getName()).toBe('Orca Dev')
    expect(app.getPath('userData')).toBe(join(appData, 'orca-dev'))
  })
})

describe('the credential folder at startup', () => {
  it('is ~/.pod for packaged Pod, whose key Orca cannot read', () => {
    startUntilKeychainNameIsFixed(false)

    expect(integrationCredentialDir()).toBe(join(root, 'home', '.pod'))
  })

  it("stays Orca's ~/.orca for a development build", () => {
    startUntilKeychainNameIsFixed(true)

    expect(integrationCredentialDir()).not.toContain('.pod')
    expect(existsSync(join(root, 'home', '.pod'))).toBe(false)
  })
})

describe('paths packaged Pod derives at startup', () => {
  it('keep the data folder of a person who already runs Pod', () => {
    const pod = join(appData, 'Pod')
    mkdirSync(pod)
    writeFileSync(join(pod, 'pod-data-origin.json'), '{}\n')
    writeFileSync(join(pod, 'orca-data.json'), '{"repos":[]}\n')
    mkdirSync(join(appData, 'orca'))
    writeFileSync(join(appData, 'orca', 'orca-data.json'), '{"orca":true}\n')

    startUntilKeychainNameIsFixed(false)

    expect(app.getPath('userData')).toBe(pod)
    expect(getCanonicalUserDataPath()).toBe(pod)
    expect(getDataFile()).toBe(join(pod, 'orca-data.json'))
    expect(process.env.ORCA_USER_DATA_PATH).toBe(pod)
    expect(readFileSync(join(pod, 'orca-data.json'), 'utf8')).toBe('{"repos":[]}\n')
    expect(readFileSync(join(appData, 'orca', 'orca-data.json'), 'utf8')).toBe('{"orca":true}\n')
  })

  it('give a new person the same Pod folder', () => {
    startUntilKeychainNameIsFixed(false)

    expect(app.getPath('userData')).toBe(join(appData, 'Pod'))
    expect(getCanonicalUserDataPath()).toBe(join(appData, 'Pod'))
    expect(existsSync(join(appData, 'orca'))).toBe(false)
  })
})
