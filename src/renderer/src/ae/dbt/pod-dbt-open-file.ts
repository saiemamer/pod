import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { getOpenedEditFileIdAfterOpen } from '@/store/slices/editor/file-ids/editor-file-ids'
import { relativeToRoot, worktreeRootOf } from './pod-dbt-paths'

/**
 * Pod: open a model file from the lineage canvas or the Database explorer, the way the
 * file explorer does (preview tab, editor focused), and hand back its editor id so the
 * dock can be pointed at a view.
 */
export type PodDbtOpenTarget = {
  worktreeId: string
  worktreePath: string | null
  filePath: string
  runtimeEnvironmentId?: string | null
}

export function openPodDbtFile(target: PodDbtOpenTarget): string | null {
  const state = useAppStore.getState()
  state.openFile(
    {
      filePath: target.filePath,
      relativePath: relativeToRoot(target.worktreePath, target.filePath),
      worktreeId: target.worktreeId,
      runtimeEnvironmentId: target.runtimeEnvironmentId ?? undefined,
      language: detectLanguage(target.filePath),
      mode: 'edit'
    },
    {
      preview: true,
      focusEditor: true,
      targetGroupId: state.activeGroupIdByWorktree?.[target.worktreeId],
      recordReplacedPreview: true
    }
  )
  return getOpenedEditFileIdAfterOpen(useAppStore.getState(), target.filePath, target.worktreeId)
}

/** The worktree the given editor belongs to, for opening a sibling model beside it. */
export function podDbtOpenTargetFromEditor(
  ownerFileId: string,
  projectDir: string,
  relativeModelPath: string
): PodDbtOpenTarget | null {
  const owner = useAppStore.getState().openFiles.find((file) => file.id === ownerFileId)
  if (!owner) {
    return null
  }
  return {
    worktreeId: owner.worktreeId,
    worktreePath: worktreeRootOf(owner.filePath, owner.relativePath),
    filePath: joinPath(projectDir, relativeModelPath),
    runtimeEnvironmentId: owner.runtimeEnvironmentId
  }
}

/** Opens the model and shows the dock's Lineage tab under it. */
export function openPodDbtLineageFor(target: PodDbtOpenTarget): void {
  const fileId = openPodDbtFile(target)
  if (fileId) {
    useAppStore.getState().openAeDbtView(fileId, target.filePath, 'lineage')
  }
}
