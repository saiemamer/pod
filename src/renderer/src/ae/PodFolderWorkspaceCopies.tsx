import { useMemo } from 'react'
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { getAttachedWorktreesForFolderWorkspace } from '@/components/right-sidebar/folder-workspace-attached-worktrees'
import { SIDEBAR_TREE_INDENT } from '@/components/sidebar/worktree-list/rows/indentation'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { WorkspaceLineage, WorktreeLineage } from '../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../shared/worktree/types'

// Why: Orca's sidebar row tests mount this with a partial store; stable empties keep selectors cached.
const NO_FOLDER_WORKSPACES: readonly FolderWorkspace[] = []
const NO_WORKSPACE_LINEAGE: Record<string, WorkspaceLineage> = {}
const NO_WORKTREE_LINEAGE: Record<string, WorktreeLineage> = {}
const NO_WORKTREES: Record<string, readonly Worktree[]> = {}

export function podFolderWorkspaceCopiesCollapseKey(folderWorkspaceId: string): string {
  return `pod-folder-copies:${folderWorkspaceId}`
}

/**
 * Pod: the worktrees made with `--parent-worktree folder:<id>`, listed under that folder
 * workspace's sidebar row. Orca's own nesting only takes a worktree of the same repo as parent.
 */
export function PodFolderWorkspaceCopies({
  folderWorkspaceId,
  indent
}: {
  folderWorkspaceId: string
  indent: number
}): React.JSX.Element | null {
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces ?? NO_FOLDER_WORKSPACES)
  const workspaceLineageByChildKey = useAppStore(
    (s) => s.workspaceLineageByChildKey ?? NO_WORKSPACE_LINEAGE
  )
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById ?? NO_WORKTREE_LINEAGE)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo ?? NO_WORKTREES)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const collapseKey = podFolderWorkspaceCopiesCollapseKey(folderWorkspaceId)
  const collapsed = useAppStore((s) => s.collapsedGroups?.has(collapseKey) ?? false)
  const toggleCollapsedGroup = useAppStore((s) => s.toggleCollapsedGroup)
  const copies = useMemo(
    () =>
      getAttachedWorktreesForFolderWorkspace({
        activeWorkspaceKey: folderWorkspaceKey(folderWorkspaceId),
        activeWorktreeId: null,
        folderWorkspaces,
        workspaceLineageByChildKey,
        worktreeLineageById,
        worktreesByRepo
      }).childWorktrees,
    [
      folderWorkspaceId,
      folderWorkspaces,
      workspaceLineageByChildKey,
      worktreeLineageById,
      worktreesByRepo
    ]
  )
  if (copies.length === 0) {
    return null
  }
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    // Why: the folder row starts a drag on pointer down; these buttons are not drag handles.
    <div
      data-pod-folder-copies={folderWorkspaceId}
      className="pb-1 pr-2 text-[11px] text-muted-foreground"
      style={{ paddingLeft: indent + SIDEBAR_TREE_INDENT }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground"
        aria-expanded={!collapsed}
        onClick={() => toggleCollapsedGroup(collapseKey)}
      >
        <Chevron className="size-3" aria-hidden="true" />
        {translate('pod.sidebar.folderCopies', 'Worker copies ({{value0}})', {
          value0: copies.length
        })}
      </button>
      {!collapsed &&
        copies.map((worktree) => (
          <button
            key={worktree.id}
            type="button"
            data-pod-folder-copy-id={worktree.id}
            aria-current={activeWorktreeId === worktree.id ? 'page' : undefined}
            className="flex w-full min-w-0 items-center gap-1 rounded-sm py-0.5 pl-4 text-left hover:bg-accent hover:text-foreground aria-[current=page]:text-foreground"
            title={translate('pod.sidebar.openFolderCopy', 'Open the worker’s copy')}
            onClick={() => activateAndRevealWorktree(worktree.id)}
          >
            <GitBranch className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate font-mono">{worktree.displayName}</span>
          </button>
        ))}
    </div>
  )
}
