import { resolveRuntimePath } from '../../../../shared/cross-platform-path'
import { getRelativePathInsideRoot } from '@/lib/path'

/** Pod: path arithmetic for opening one worktree file from another, without node:path. */

/** The worktree root, given that relativePath is filePath's tail. */
export function worktreeRootOf(filePath: string, relativePath: string): string | null {
  const normalizedFile = filePath.replace(/\\/g, '/')
  const normalizedRelative = relativePath.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!normalizedRelative || !normalizedFile.endsWith(`/${normalizedRelative}`)) {
    return null
  }
  return normalizedFile.slice(0, normalizedFile.length - normalizedRelative.length - 1)
}

/**
 * Path relative to the worktree root, or null when the target resolves outside it. Why null: these
 * paths come from file content, and an absolute tab would read as user-named; main still follows
 * symlinks for the project tab this opens.
 */
export function relativeInsideRoot(root: string | null, targetPath: string): string | null {
  if (!root) {
    return null
  }
  return getRelativePathInsideRoot(resolveRuntimePath(root, targetPath), root) || null
}
