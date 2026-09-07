import { useAppStore } from '@/store'
import { podDbtRunTarget } from './pod-dbt-run-target'

/**
 * Pod: the editor showing a file, found through Monaco's own registry, so no upstream
 * mount hook has to hand the instance over. Monaco loads lazily here because the edit
 * surface's unit tests mount it without a window.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function pathMatches(candidate: string, wanted: string): boolean {
  const normalized = normalizePath(candidate)
  return (
    normalized === wanted || normalized.endsWith(`/${wanted}`) || wanted.endsWith(`/${normalized}`)
  )
}

/** The focused editor's selection for this file, or null when nothing is selected. */
export async function readPodDbtSelection(filePath: string): Promise<string | null> {
  const { monaco } = await import('@/lib/monaco-setup')
  const wanted = normalizePath(filePath)
  const editors = monaco.editor.getEditors().filter((editor) => {
    const uri = editor.getModel()?.uri
    return uri ? [uri.path, uri.fsPath].some((candidate) => pathMatches(candidate, wanted)) : false
  })
  const editor = editors.find((entry) => entry.hasTextFocus()) ?? editors[0]
  const selection = editor?.getSelection()
  const model = editor?.getModel()
  if (!editor || !selection || !model || selection.isEmpty()) {
    return null
  }
  return model.getValueInRange(selection)
}

/** True when the keyboard focus sits in a Monaco editor inside `root` (the dock's pane). */
export function podDbtEditorHasFocus(root: HTMLElement | null): boolean {
  const active = document.activeElement
  return Boolean(root && active && root.contains(active) && active.closest('.monaco-editor'))
}

export async function startPodDbtRun(
  file: { id: string; filePath: string },
  kind: 'show' | 'compile'
): Promise<void> {
  const selection = await readPodDbtSelection(file.filePath)
  await useAppStore.getState().runAeDbt({
    fileId: file.id,
    filePath: file.filePath,
    kind,
    target: podDbtRunTarget(file.filePath, selection)
  })
}
