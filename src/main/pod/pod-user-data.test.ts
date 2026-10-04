import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROFILE_STATE_DATABASE_SCHEMA_VERSION } from '../persistence/profile-state/profile-state-database-schema'
import Database from '../sqlite/sync-database'
import { movePodUserDataOnce, type PodUserDataMoveOptions } from './pod-user-data'

// A pid no process holds, for lock and pointer files left by a dead app.
const DEAD_PID = 2_147_483_000
const NOW = new Date('2026-10-04T12:00:00Z')

let root: string
let appData: string
let home: string
let orca: string
let pod: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-user-data-'))
  appData = join(root, 'Application Support')
  home = join(root, 'home')
  orca = join(appData, 'orca')
  pod = join(appData, 'Pod')
  mkdirSync(appData, { recursive: true })
  mkdirSync(home)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(path: string, content = path): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function move(
  overrides: Partial<PodUserDataMoveOptions> = {}
): ReturnType<typeof movePodUserDataOnce> {
  return movePodUserDataOnce({
    appDataDir: appData,
    homeDir: home,
    systemApplicationsDir: join(root, 'Applications'),
    podVersion: '0.1.12',
    now: NOW,
    describeProcess: () => null,
    ...overrides
  })
}

function markStockOrcaInstalled(): void {
  write(join(home, 'Library', 'Preferences', 'com.stablyai.orca.plist'))
}

function stagingFolders(): string[] {
  return readdirSync(appData).filter((name) => name.startsWith('Pod.moving'))
}

describe('movePodUserDataOnce', () => {
  it.each([
    'pod-data-origin.json',
    'profiles/local-default/orca-data.json',
    'orca-profile-index.json'
  ])('skips when Pod already has %s', (existing) => {
    write(join(pod, existing))
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'), '{"orca":true}')

    expect(move()).toEqual({ kind: 'already-moved' })
    expect(existsSync(join(pod, 'pod-data-origin.json'))).toBe(existing === 'pod-data-origin.json')
    expect(existsSync(orca)).toBe(true)
  })

  it('starts empty when there is no Orca data to copy', () => {
    write(join(orca, 'logs', 'main.log'))

    expect(move()).toEqual({ kind: 'fresh' })
    expect(existsSync(pod)).toBe(false)
  })

  it.each(['profiles/local-default/orca-data.json', 'orca-data.json'])(
    'copies when the old folder has %s',
    (existing) => {
      write(join(orca, existing), '{"repos":[]}')

      expect(move()).toMatchObject({ kind: 'moved' })
      expect(readFileSync(join(pod, existing), 'utf8')).toBe('{"repos":[]}')
    }
  )

  it.each([
    [
      'orca-runtime.json',
      (pid: number) => write(join(orca, 'orca-runtime.json'), JSON.stringify({ pid }))
    ],
    ['SingletonLock', (pid: number) => symlinkSync(`host-${pid}`, join(orca, 'SingletonLock'))]
  ])('refuses while an app named in %s still runs, copying nothing', (_file, recordPid) => {
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'))
    // The vitest parent process stands in for a running app.
    recordPid(process.ppid)

    expect(() =>
      move({ describeProcess: () => '/Applications/Orca.app/Contents/MacOS/Orca' })
    ).toThrow(/Quit Orca or the older Pod/)
    expect(existsSync(pod)).toBe(false)
    expect(stagingFolders()).toEqual([])
    expect(existsSync(join(orca, 'profiles', 'local-default', 'orca-data.json'))).toBe(true)
  })

  it('copies when the recorded pid now belongs to something other than an app', () => {
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'))
    write(join(orca, 'orca-runtime.json'), JSON.stringify({ pid: process.ppid }))

    expect(move({ describeProcess: () => '/usr/local/bin/node' })).toMatchObject({ kind: 'moved' })
  })

  it('copies state, leaves locks, sockets, caches and pairing files behind, and keeps the source', () => {
    const copied = [
      'profiles/local-default/orca-data.json',
      'orca-profile-index.json',
      'orchestration.db',
      'orchestration.db-wal',
      'codex-accounts/acct/auth.json',
      'terminal-history/session.log',
      'Local Storage/leveldb/000003.log',
      'Cookies',
      'Partitions/browser/Cookies',
      'agent-hooks/claude-hook.sh',
      'pod/dbt-language-server',
      'orca-stats.json'
    ]
    const leftBehind = [
      'SingletonSocket',
      'SingletonCookie',
      'DevToolsActivePort',
      'o-123-abc.sock',
      'daemon/daemon-v36.sock',
      'Cache/data_0',
      'Code Cache/js/index',
      'GPUCache/data_1',
      'DawnGraphiteCache/data_0',
      'Crashpad/settings.dat',
      'logs/main.log',
      'pod-upgrade.command',
      'orca-devices.json',
      'orca-e2ee-keypair.json',
      'agent-hooks/endpoint.env',
      'agent-hooks/last-status.json'
    ]
    for (const path of [...copied, ...leftBehind]) {
      write(join(orca, path))
    }
    write(join(orca, 'orca-runtime.json'), JSON.stringify({ pid: DEAD_PID }))
    write(join(orca, 'daemon', 'daemon-v36.pid'), String(DEAD_PID))
    symlinkSync(`host-${DEAD_PID}`, join(orca, 'SingletonLock'))
    markStockOrcaInstalled()

    expect(move()).toMatchObject({ kind: 'moved', oldFolder: 'kept' })

    for (const path of copied) {
      expect(readFileSync(join(pod, path), 'utf8'), path).toBe(join(orca, path))
    }
    for (const path of [...leftBehind, 'orca-runtime.json', 'SingletonLock', 'daemon']) {
      expect(existsSync(join(pod, path)), path).toBe(false)
    }
    for (const path of [...copied, ...leftBehind]) {
      expect(existsSync(join(orca, path)), path).toBe(true)
    }
    expect(JSON.parse(readFileSync(join(pod, 'pod-data-origin.json'), 'utf8'))).toEqual({
      source: orca,
      copiedAt: NOW.toISOString(),
      podVersion: '0.1.12'
    })
  })

  it('leaves no Pod folder, staging folder or marker when the copy fails part way', () => {
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'))
    const unreadable = join(orca, 'codex-accounts', 'auth.json')
    write(unreadable)
    chmodSync(unreadable, 0o000)

    try {
      expect(() => move()).toThrow()
      expect(existsSync(pod)).toBe(false)
      expect(stagingFolders()).toEqual([])
    } finally {
      chmodSync(unreadable, 0o600)
    }
    expect(move()).toMatchObject({ kind: 'moved' })
    expect(existsSync(join(pod, 'codex-accounts', 'auth.json'))).toBe(true)
  })

  it('drops a dead launch staging folder without its marker and copies afresh', () => {
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'), 'current')
    write(
      join(appData, `Pod.moving-${DEAD_PID}`, 'profiles', 'local-default', 'orca-data.json'),
      'half'
    )

    expect(move()).toMatchObject({ kind: 'moved' })
    expect(readFileSync(join(pod, 'profiles', 'local-default', 'orca-data.json'), 'utf8')).toBe(
      'current'
    )
    expect(stagingFolders()).toEqual([])
  })

  it('finishes a dead launch staging folder whose marker landed', () => {
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'), 'current')
    const staging = join(appData, `Pod.moving-${DEAD_PID}`)
    write(join(staging, 'profiles', 'local-default', 'orca-data.json'), 'staged')
    write(join(staging, 'pod-data-origin.json'), '{}')

    expect(move()).toEqual({ kind: 'already-moved' })
    expect(readFileSync(join(pod, 'profiles', 'local-default', 'orca-data.json'), 'utf8')).toBe(
      'staged'
    )
    expect(stagingFolders()).toEqual([])
  })

  it('replaces an existing empty lower-case pod folder and spells the result Pod', () => {
    mkdirSync(join(appData, 'pod'))
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'))

    expect(move()).toMatchObject({ kind: 'moved' })
    expect(readdirSync(appData)).toContain('Pod')
    expect(existsSync(join(appData, 'Pod', 'profiles', 'local-default', 'orca-data.json'))).toBe(
      true
    )
  })

  it('merges a Pod folder that holds no Pod data yet', () => {
    write(join(pod, 'logs', 'main.log'), 'pod log')
    write(join(pod, 'pod', 'dbt-language-server'), 'pod download')
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'))
    write(join(orca, 'pod', 'dbt-language-server'), 'orca download')

    expect(move()).toMatchObject({ kind: 'moved' })
    expect(readFileSync(join(pod, 'logs', 'main.log'), 'utf8')).toBe('pod log')
    expect(readFileSync(join(pod, 'pod', 'dbt-language-server'), 'utf8')).toBe('orca download')
    expect(existsSync(join(pod, 'profiles', 'local-default', 'orca-data.json'))).toBe(true)
  })

  it('renames the old folder when the Mac shows no sign of stock Orca', () => {
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'), 'data')

    expect(move()).toMatchObject({ kind: 'moved', oldFolder: 'renamed' })
    expect(existsSync(orca)).toBe(false)
    expect(
      readFileSync(
        join(
          appData,
          'orca.moved-to-pod-2026-10-04',
          'profiles',
          'local-default',
          'orca-data.json'
        ),
        'utf8'
      )
    ).toBe('data')
  })

  it.each([
    [
      '/Applications/Orca.app',
      () => mkdirSync(join(root, 'Applications', 'Orca.app'), { recursive: true })
    ],
    [
      '~/Applications/Orca.app',
      () => mkdirSync(join(home, 'Applications', 'Orca.app'), { recursive: true })
    ],
    ['Orca preferences', markStockOrcaInstalled]
  ])('keeps the old folder in place for stock Orca when %s exists', (_sign, addSign) => {
    write(join(orca, 'profiles', 'local-default', 'orca-data.json'))
    addSign()

    expect(move()).toMatchObject({ kind: 'moved', oldFolder: 'kept' })
    expect(existsSync(join(orca, 'profiles', 'local-default', 'orca-data.json'))).toBe(true)
  })
})

describe('movePodUserDataOnce with a SQLite profile', () => {
  const profile = (folder: string): string => join(folder, 'profiles', 'local-default')

  function createDatabase(path: string, userVersion: number): void {
    mkdirSync(dirname(path), { recursive: true })
    const db = new Database(path)
    db.exec('CREATE TABLE t (x INTEGER)')
    db.exec(`PRAGMA user_version = ${userVersion}`)
    db.close()
  }

  it('copies a database Pod can open', () => {
    createDatabase(join(profile(orca), 'profile-state.db'), PROFILE_STATE_DATABASE_SCHEMA_VERSION)
    write(join(profile(orca), 'orca-data.json.sqlite-export.1.json'), 'export')

    expect(move()).toMatchObject({ kind: 'moved', profileDatabase: 'copied' })
    expect(existsSync(join(profile(pod), 'profile-state.db'))).toBe(true)
    expect(existsSync(join(profile(pod), 'orca-data.json.sqlite-export.1.json'))).toBe(true)
  })

  it('swaps a database from a newer Orca for its newest JSON export', () => {
    const sourceDb = join(profile(orca), 'profile-state.db')
    createDatabase(sourceDb, PROFILE_STATE_DATABASE_SCHEMA_VERSION + 1)
    const sourceBytes = readFileSync(sourceDb)
    write(join(profile(orca), 'orca-data.json'), 'older compatibility copy')
    write(join(profile(orca), 'orca-data.json.sqlite-export.4.json'), 'export 4')
    write(join(profile(orca), 'orca-data.json.sqlite-export.5.json'), 'export 5')
    write(
      join(
        profile(orca),
        'profile-state.db.backup.1700000000000-0b3c2d1e-1111-4222-8333-444455556666.db'
      ),
      'backup'
    )
    markStockOrcaInstalled()

    expect(move()).toMatchObject({ kind: 'moved', profileDatabase: 'replaced-by-json-export' })
    expect(readdirSync(profile(pod)).sort()).toEqual(['orca-data.json'])
    expect(readFileSync(join(profile(pod), 'orca-data.json'), 'utf8')).toBe('export 5')
    expect(readFileSync(sourceDb).equals(sourceBytes)).toBe(true)
  })
})
