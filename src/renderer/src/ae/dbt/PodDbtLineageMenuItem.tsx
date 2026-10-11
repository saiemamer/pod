import { useEffect, useState } from 'react'
import { GitFork } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree } from '@/store/selectors'
import { isDbtModelFile } from './pod-dbt-model-file'
import { openPodDbtLineageFor } from './pod-dbt-open-file'

/**
 * Pod: "Show lineage" in the file explorer's context menu, for a model of a dbt project
 * only. Same action as Cmd+Option+L in the editor and the Database tab's lineage button.
 */
export function PodDbtLineageMenuItem({
  filePath,
  isDirectory
}: {
  filePath: string
  isDirectory: boolean
}): React.JSX.Element | null {
  const [isModel, setIsModel] = useState(false)
  const candidate = !isDirectory && filePath.toLowerCase().endsWith('.sql')
  useEffect(() => {
    const api = window.api?.ae?.dbt
    if (!candidate || !api) {
      return
    }
    let cancelled = false
    // Why ask main: model-paths come from dbt_project.yml; a folder outside them holds no models.
    api
      .project({ path: filePath })
      .then((context) => {
        if (!cancelled) {
          setIsModel(isDbtModelFile(filePath, context.project))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [candidate, filePath])
  // Why a child: only a model needs the worktree, and Orca's row-menu tests mount this with a
  // mocked store that has no worktree lookup.
  return isModel ? <PodDbtLineageMenuItemForModel filePath={filePath} /> : null
}

function PodDbtLineageMenuItemForModel({
  filePath
}: {
  filePath: string
}): React.JSX.Element | null {
  const worktree = useActiveWorktree()
  if (!worktree) {
    return null
  }
  return (
    <ContextMenuItem
      data-testid="pod-dbt-show-lineage"
      onSelect={() =>
        openPodDbtLineageFor({
          worktreeId: worktree.id,
          worktreePath: worktree.path,
          filePath
        })
      }
    >
      <GitFork />
      {translate('pod.dbt.explorer.lineage', 'Show lineage')}
    </ContextMenuItem>
  )
}
