import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

/** Pod: the managed worktree a path sits in, as dbt and Omni commands need it. */
export type PodWorktreeForPath = {
  id: string
  repoId: string
  path: string
  /** Local branch name without `refs/heads/`; null on a detached HEAD. */
  branch: string | null
}

/** Walk up from the path asking Orca for a managed worktree at each directory. */
export async function findManagedWorktreeForPath(
  runtime: OrcaRuntimeService,
  path: string
): Promise<PodWorktreeForPath | null> {
  let dir = isDirectory(path) ? path : dirname(path)
  for (let depth = 0; depth < 16; depth += 1) {
    try {
      const worktree = await runtime.showManagedWorktree(`path:${dir}`)
      const branch = worktree.git?.branch?.replace(/^refs\/heads\//, '') ?? ''
      return {
        id: worktree.id,
        repoId: worktree.repoId,
        path: worktree.path,
        branch: branch || null
      }
    } catch {
      // Why: selector_not_found is the normal answer for a subdirectory; keep climbing.
    }
    const parent = dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

export function findGitRoot(path: string): string | null {
  let dir = isDirectory(path) ? path : dirname(path)
  for (let depth = 0; depth < 32; depth += 1) {
    if (existsSync(join(dir, '.git'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
  return null
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
