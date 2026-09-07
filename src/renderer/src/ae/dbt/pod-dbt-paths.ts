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

/** Path relative to the worktree root, or the absolute path when the target sits outside it. */
export function relativeToRoot(root: string | null, targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, '/')
  return root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : targetPath
}
