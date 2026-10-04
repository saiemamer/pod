import {
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import {
  getOrcaProfileDataFile,
  getOrcaProfileStateDatabaseFile
} from '../../shared/profile-state-storage-paths'
import { profileStateJsonExportPaths } from '../persistence/profile-state/legacy-json/profile-state-export-path'
import { profileStateDatabaseBackups } from '../persistence/profile-state/profile-state-backup-path'
import { profileStatePragmaNumber } from '../persistence/profile-state/profile-state-database'
import { PROFILE_STATE_DATABASE_SCHEMA_VERSION } from '../persistence/profile-state/profile-state-database-schema'
import { profileStateDatabaseFiles } from '../persistence/profile-state/profile-state-storage-classification'
import { MOBILE_PAIRING_USERDATA_FILES } from '../runtime/mobile-pairing-files'
import Database from '../sqlite/sync-database'

/** Top-level entries a running app owns or rebuilds: locks, sockets, daemon, caches, logs. */
const LEFT_BEHIND_NAMES = new Set<string>([
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
  'DevToolsActivePort',
  'orca-runtime.json',
  'daemon',
  'Cache',
  'Code Cache',
  'GPUCache',
  'Crashpad',
  'logs',
  'pod-upgrade.command',
  // Why: Pod hides Orca Mobile, and a copied keypair would pair one phone with both apps.
  ...MOBILE_PAIRING_USERDATA_FILES
])
const LEFT_BEHIND_PATTERNS = [/^o-.*\.sock$/, /^Dawn/]
/** Rewritten by the app at startup; a copy would point hooks at the old app's port. */
const LEFT_BEHIND_AGENT_HOOK_FILES = new Set(['endpoint.env', 'endpoint.cmd', 'last-status.json'])

export type ProfileDatabaseOutcome = 'none' | 'copied' | 'replaced-by-json-export'

function isLeftBehind(relativePath: string): boolean {
  if (relativePath === '') {
    return false
  }
  const [top] = relativePath.split(sep)
  if (LEFT_BEHIND_NAMES.has(top) || LEFT_BEHIND_PATTERNS.some((pattern) => pattern.test(top))) {
    return true
  }
  return top === 'agent-hooks' && LEFT_BEHIND_AGENT_HOOK_FILES.has(basename(relativePath))
}

/** cpSync throws on sockets, FIFOs and devices, so anything else is skipped wherever it sits. */
function isCopyableEntry(path: string): boolean {
  const stats = lstatSync(path)
  return stats.isFile() || stats.isDirectory() || stats.isSymbolicLink()
}

/** Copy (never move) Orca's data folder into `staging`, cloning on APFS. */
export function copyOrcaUserData(source: string, staging: string): ProfileDatabaseOutcome {
  mkdirSync(staging)
  cpSync(source, staging, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: (path) => isCopyableEntry(path) && !isLeftBehind(relative(source, path))
  })
  return replaceNewerProfileDatabases(staging)
}

/**
 * Pod refuses a profile database saved by a newer Orca, so a newer one is swapped for its newest
 * JSON snapshot. Opened in the staged copy only: SQLite may replay the WAL, and the source stays untouched.
 */
function replaceNewerProfileDatabases(staging: string): ProfileDatabaseOutcome {
  const profilesDir = join(staging, 'profiles')
  if (!existsSync(profilesDir)) {
    return 'none'
  }
  let outcome: ProfileDatabaseOutcome = 'none'
  for (const profileId of readdirSync(profilesDir)) {
    const databaseFile = getOrcaProfileStateDatabaseFile(profileId, staging)
    if (!existsSync(databaseFile)) {
      continue
    }
    if (readSchemaVersion(databaseFile) <= PROFILE_STATE_DATABASE_SCHEMA_VERSION) {
      outcome = outcome === 'none' ? 'copied' : outcome
      continue
    }
    const dataFile = getOrcaProfileDataFile(profileId, staging)
    const [newestExport, ...olderExports] = profileStateJsonExportPaths(dataFile)
    if (newestExport === undefined && !existsSync(dataFile)) {
      // Why: with no JSON to fall back on, Pod's own "saved by a newer version" message beats an empty profile.
      outcome = outcome === 'none' ? 'copied' : outcome
      continue
    }
    // Why: Orca writes orca-data.json only after publishing the same snapshot as an export
    // (profile-state-authority-exports.ts), so it is newer only when a JSON-era build edited it later.
    if (newestExport !== undefined && !isLaterEdit(dataFile, newestExport)) {
      renameSync(newestExport, dataFile)
    } else if (newestExport !== undefined) {
      rmSync(newestExport, { force: true })
    }
    // Why: Orca treats a retained export or backup beside a missing database as lost state and refuses to start.
    const backups = profileStateDatabaseBackups(databaseFile).map(({ path }) => path)
    for (const path of [...profileStateDatabaseFiles(databaseFile), ...olderExports, ...backups]) {
      rmSync(path, { force: true })
    }
    outcome = 'replaced-by-json-export'
  }
  return outcome
}

function isLaterEdit(dataFile: string, exportFile: string): boolean {
  return (
    existsSync(dataFile) &&
    statSync(dataFile).mtimeMs > statSync(exportFile).mtimeMs &&
    !readFileSync(dataFile).equals(readFileSync(exportFile))
  )
}

function readSchemaVersion(databaseFile: string): number {
  const db = new Database(databaseFile)
  try {
    return profileStatePragmaNumber(db, 'user_version')
  } finally {
    db.close()
  }
}
