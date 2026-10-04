import { readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { runProcessSync } from '../../shared/child-process/run-process'
import { getRuntimeMetadataPath } from '../../shared/runtime-bootstrap'

/** Only ESRCH proves a pid gone; EPERM means another user's live process. */
export function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

/** Executable path of a live pid, or null when it cannot be read. */
export type DescribeProcess = (pid: number) => string | null

export function describeProcessWithPs(pid: number): string | null {
  try {
    const result = runProcessSync({
      program: '/bin/ps',
      args: ['-p', String(pid), '-o', 'comm='],
      timeoutMs: 2_000
    })
    const command = result.stdout.trim()
    return result.code === 0 && command !== '' ? command : null
  } catch {
    return null
  }
}

function readRuntimePid(folder: string): number | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(getRuntimeMetadataPath(folder), 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && 'pid' in parsed) {
      return typeof parsed.pid === 'number' ? parsed.pid : null
    }
  } catch {
    // No pointer, or a half-written one: the app is not serving from this folder.
  }
  return null
}

/** A recorded pid counts only while it is still a Pod process, not whatever reused it. */
export function isPodAppProcess(pid: number, describeProcess: DescribeProcess): boolean {
  return (
    pid !== process.pid &&
    isProcessRunning(pid) &&
    describeProcess(pid)?.includes('/Pod.app/') === true
  )
}

/** Chromium's lock is a symlink to `<host>-<pid>`. */
function readSingletonLockPid(folder: string): number | null {
  try {
    const match = /-(\d+)$/.exec(readlinkSync(join(folder, 'SingletonLock')))
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

/**
 * Refuse to copy while Orca or an older Pod runs on `folder`: once the folders differ,
 * Electron's lock no longer keeps the two apart, and the copy would miss its last writes.
 */
export function assertNoAppUsesFolder(folder: string, describeProcess: DescribeProcess): void {
  for (const pid of [readRuntimePid(folder), readSingletonLockPid(folder)]) {
    if (pid === null || pid === process.pid || !isProcessRunning(pid)) {
      continue
    }
    const command = describeProcess(pid)
    // Why: a crashed app's pid can be reused by anything; only an app bundle counts, and unknown fails safe.
    if (command === null || command.includes('.app/Contents/MacOS/')) {
      throw new Error(
        `Quit Orca or the older Pod before opening Pod. Process ${pid} is still using ${folder}.`
      )
    }
  }
}

/** The old Pod's terminal daemon outlives the app and would never be reached again. */
export function stopStalePodDaemon(folder: string, describeProcess: DescribeProcess): void {
  const daemonDir = join(folder, 'daemon')
  let names: string[]
  try {
    names = readdirSync(daemonDir).filter((name) => /^daemon-v\d+\.pid$/.test(name))
  } catch {
    return
  }
  for (const name of names) {
    try {
      const pid = Number.parseInt(readFileSync(join(daemonDir, name), 'utf8').trim(), 10)
      if (isPodAppProcess(pid, describeProcess)) {
        process.kill(pid, 'SIGTERM')
      }
    } catch (error) {
      console.warn(`[pod-user-data] Could not stop the old terminal daemon (${name}):`, error)
    }
  }
}
