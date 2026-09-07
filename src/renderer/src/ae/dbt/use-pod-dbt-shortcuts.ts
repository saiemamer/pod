import { useEffect, type RefObject } from 'react'
import { keybindingMatchesAction } from '../../../../shared/keybindings/matching'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { useAppStore } from '@/store'
import { podDbtEditorHasFocus, startPodDbtRun } from './pod-dbt-run'

/**
 * Pod: Cmd+Enter runs, Cmd+Shift+Enter compiles, in the Jinja SQL editor of this pane.
 * Same capture-phase pattern as the markdown preview shortcut, so user rebindings apply.
 */
export function usePodDbtShortcuts(
  file: { id: string; filePath: string } | null,
  paneRef: RefObject<HTMLElement | null>
): void {
  const keybindings = useAppStore((state) => state.keybindings)
  const fileId = file?.id ?? null
  const filePath = file?.filePath ?? null
  useEffect(() => {
    if (!fileId || !filePath) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) {
        return
      }
      const platform = getShortcutPlatform()
      const action = (
        ['dbt.runSelection', 'dbt.compileSelection', 'dbt.showLineage'] as const
      ).find((id) => keybindingMatchesAction(id, event, platform, keybindings))
      // Why the focus check: a terminal or another pane keeps its own Enter.
      if (!action || !podDbtEditorHasFocus(paneRef.current)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (action === 'dbt.showLineage') {
        useAppStore.getState().openAeDbtView(fileId, filePath, 'lineage')
        return
      }
      void startPodDbtRun(
        { id: fileId, filePath },
        action === 'dbt.runSelection' ? 'show' : 'compile'
      )
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [fileId, filePath, keybindings, paneRef])
}
