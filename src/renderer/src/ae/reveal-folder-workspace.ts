import { activateAndRevealFolderWorkspace } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'

/**
 * Pod: activate a folder workspace by its `folder:<id>` key. The main process opened the
 * agent session that is the workspace's surface, so activation must not seed a shell.
 */
export async function revealPodFolderWorkspace(workspaceKey: string | undefined): Promise<boolean> {
  const id = workspaceKey?.replace(/^folder:/, '')
  if (!id) {
    return false
  }
  if (activateAndRevealFolderWorkspace(id, { providesInitialSurface: true }) !== false) {
    return true
  }
  // Why: a workspace created a moment ago may not be in the renderer's list yet.
  await useAppStore.getState().fetchFolderWorkspaces()
  return activateAndRevealFolderWorkspace(id, { providesInitialSurface: true }) !== false
}
