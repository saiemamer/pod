import type { App } from 'electron'
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'
import { POD_KEYCHAIN_APP_NAME, POD_USER_DATA_DIR_NAME } from '../../shared/brand'
import { copyOrcaUserData, type ProfileDatabaseOutcome } from './pod-user-data-copy'
import {
  assertNoAppUsesFolder,
  describeProcessWithPs,
  isPodAppProcess,
  stopStalePodDaemon,
  type DescribeProcess
} from './pod-user-data-in-use'

/** Electron names this after package.json `name`, which packaged Pod still shares with Orca. */
const ORCA_USER_DATA_DIR_NAME = 'orca'
const ORIGIN_MARKER_FILE = 'pod-data-origin.json'
const STAGING_PREFIX = `${POD_USER_DATA_DIR_NAME}.moving-`
const MOVE_LOCK_FILE = `${POD_USER_DATA_DIR_NAME}.moving.lock`

export type PodUserDataMoveOptions = {
  /** `~/Library/Application Support` on macOS. */
  appDataDir: string
  homeDir: string
  systemApplicationsDir?: string
  podVersion: string
  now?: Date
  describeProcess?: DescribeProcess
}

export type PodUserDataMoveResult =
  | { kind: 'already-moved' | 'fresh' }
  | { kind: 'moved'; oldFolder: 'renamed' | 'kept'; profileDatabase: ProfileDatabaseOutcome }

/**
 * Packaged Pod keeps its own data folder and its own Keychain item so stock Orca can live on the
 * same Mac. Runs before `ready`, so the name decides the item ("Pod Safe Storage", not Orca's
 * "orca Safe Storage"); the post-ready `app.setName` still names the menu as before.
 */
export function applyPodUserDataFolder(
  app: Pick<App, 'getPath' | 'setPath' | 'getVersion' | 'setName'>
): void {
  const appDataDir = app.getPath('appData')
  app.setPath('userData', join(appDataDir, POD_USER_DATA_DIR_NAME))
  // Why after setPath: userData is pinned, so the rename moves no path.
  app.setName(POD_KEYCHAIN_APP_NAME)
  const result = movePodUserDataOnce({
    appDataDir,
    homeDir: app.getPath('home'),
    podVersion: app.getVersion()
  })
  if (result.kind === 'moved') {
    console.log(
      `[pod-user-data] Copied ${ORCA_USER_DATA_DIR_NAME} into ${POD_USER_DATA_DIR_NAME} (old folder ${result.oldFolder}, profile database ${result.profileDatabase})`
    )
  }
}

function hasPodData(folder: string): boolean {
  return [ORIGIN_MARKER_FILE, 'profiles', 'orca-profile-index.json'].some((name) =>
    existsSync(join(folder, name))
  )
}

function hasOrcaData(folder: string): boolean {
  return ['profiles', 'orca-data.json'].some((name) => existsSync(join(folder, name)))
}

/** Copy an existing user's Orca-named data into Pod's folder, once, leaving the source intact. */
export function movePodUserDataOnce(options: PodUserDataMoveOptions): PodUserDataMoveResult {
  const target = join(options.appDataDir, POD_USER_DATA_DIR_NAME)
  const source = join(options.appDataDir, ORCA_USER_DATA_DIR_NAME)
  if (hasPodData(target)) {
    return { kind: 'already-moved' }
  }
  const describeProcess = options.describeProcess ?? describeProcessWithPs
  const releaseLock = acquireMoveLock(options.appDataDir, describeProcess)
  let profileDatabase: ProfileDatabaseOutcome
  try {
    settleEarlierStaging(options.appDataDir, target)
    if (hasPodData(target)) {
      return { kind: 'already-moved' }
    }
    if (!hasOrcaData(source)) {
      return { kind: 'fresh' }
    }
    assertNoAppUsesFolder(source, describeProcess)
    stopStalePodDaemon(source, describeProcess)
    const staging = join(options.appDataDir, `${STAGING_PREFIX}${process.pid}`)
    try {
      profileDatabase = copyOrcaUserData(source, staging)
      const origin = {
        source,
        copiedAt: (options.now ?? new Date()).toISOString(),
        podVersion: options.podVersion
      }
      writeFileSync(join(staging, ORIGIN_MARKER_FILE), `${JSON.stringify(origin, null, 2)}\n`)
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Pod could not copy its data from ${source}. No data was changed, and that folder is as it was. ${reason}`,
        { cause: error }
      )
    }
    publishStaging(staging, target)
  } finally {
    releaseLock()
  }
  return { kind: 'moved', oldFolder: retireOldFolder(source, options), profileDatabase }
}

/** Two Pod launches must not copy at once; a lock whose owner is no longer Pod is taken over. */
function acquireMoveLock(appDataDir: string, describeProcess: DescribeProcess): () => void {
  const lockPath = join(appDataDir, MOVE_LOCK_FILE)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return () => rmSync(lockPath, { force: true })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }
      const owner = Number.parseInt(readFileSync(lockPath, 'utf8'), 10)
      if (isPodAppProcess(owner, describeProcess)) {
        throw new Error('Another Pod launch is copying its data. Open Pod again in a moment.')
      }
      unlinkSync(lockPath)
    }
  }
  throw new Error(`Could not take ${lockPath}`)
}

/** Under the lock, any staging folder is from a dead launch: finish it if its marker landed, else drop it. */
function settleEarlierStaging(appDataDir: string, target: string): void {
  for (const name of readdirSync(appDataDir)) {
    if (!name.startsWith(STAGING_PREFIX)) {
      continue
    }
    const staging = join(appDataDir, name)
    if (existsSync(join(staging, ORIGIN_MARKER_FILE)) && !hasPodData(target)) {
      publishStaging(staging, target)
    } else {
      rmSync(staging, { recursive: true, force: true })
    }
  }
}

/**
 * The marker is already inside `staging`, so `target` gains Pod data in one rename. A folder there
 * without Pod data (such as the empty `pod` that macOS matches case-insensitively) is merged into the
 * copy and removed first, because renaming onto it would keep its lower-case spelling.
 */
function publishStaging(staging: string, target: string): void {
  if (existsSync(target)) {
    for (const name of readdirSync(target)) {
      if (!existsSync(join(staging, name))) {
        renameSync(join(target, name), join(staging, name))
      }
    }
    // A crash between here and the rename is finished by settleEarlierStaging.
    rmSync(target, { recursive: true, force: true })
  }
  renameSync(staging, target)
}

/** Operator choice (2026-10-04): rename the old folder only when stock Orca has never been on this Mac. */
function retireOldFolder(source: string, options: PodUserDataMoveOptions): 'renamed' | 'kept' {
  const stockOrcaSigns = [
    join(options.systemApplicationsDir ?? '/Applications', 'Orca.app'),
    join(options.homeDir, 'Applications', 'Orca.app'),
    join(options.homeDir, 'Library', 'Preferences', 'com.stablyai.orca.plist')
  ]
  if (stockOrcaSigns.some((path) => existsSync(path))) {
    return 'kept'
  }
  const date = (options.now ?? new Date()).toISOString().slice(0, 10)
  const retired = `${source}.moved-to-pod-${date}`
  if (existsSync(retired)) {
    return 'kept'
  }
  try {
    renameSync(source, retired)
    return 'renamed'
  } catch (error) {
    console.warn('[pod-user-data] Could not rename the old data folder:', error)
    return 'kept'
  }
}
