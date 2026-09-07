import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { JINJA_SQL_LANGUAGE_ID } from '@/lib/monaco-languages/register-jinja-sql'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import { getOpenedEditFileIdAfterOpen } from '@/store/slices/editor/file-ids/editor-file-ids'
import { dbtLspUriToPath } from '../../../../shared/ae/dbt-lsp-types'
import { findDbtCteDefinition, findDbtRefAtPosition } from './dbt-ref-navigation'
import { relativeToRoot, worktreeRootOf } from './pod-dbt-paths'

type MonacoModule = typeof Monaco

/**
 * Pod: Cmd-click in a dbt model. `ref()` resolves by file scan in main (no server
 * needed), a CTE name jumps inside the buffer, and everything else asks the language
 * server (sources, macros). Results are merged, so the server adds rather than gates.
 */
export async function providePodDbtDefinition(
  monaco: MonacoModule,
  model: Monaco.editor.ITextModel,
  position: Monaco.IPosition,
  options: { lspReady: (path: string) => boolean }
): Promise<Monaco.languages.Definition | null> {
  const path = model.uri.scheme === 'file' ? model.uri.fsPath : null
  const dbt = window.api?.ae?.dbt
  if (!path || !dbt) {
    return null
  }
  const line = model.getLineContent(position.lineNumber)
  const hit = findDbtRefAtPosition(line, position.column)
  const results: Monaco.languages.Location[] = []
  if (hit?.kind === 'ref') {
    const resolved = await dbt.resolveRef({ path, name: hit.name, packageName: hit.packageName })
    for (const file of [resolved.file, ...resolved.alternatives]) {
      if (file) {
        results.push({ uri: monaco.Uri.file(file), range: firstLine() })
      }
    }
  } else if (hit?.kind === 'cte') {
    const cte = findDbtCteDefinition(model.getValue(), hit.name)
    if (cte && cte.lineNumber !== position.lineNumber) {
      results.push({
        uri: model.uri,
        range: {
          startLineNumber: cte.lineNumber,
          startColumn: cte.column,
          endLineNumber: cte.lineNumber,
          endColumn: cte.column + hit.name.length
        }
      })
    }
  }
  if (results.length === 0 && options.lspReady(path)) {
    const locations = await dbt.lsp
      .definition({
        path,
        position: { line: position.lineNumber - 1, character: position.column - 1 }
      })
      .catch(() => [])
    for (const location of locations) {
      const target = dbtLspUriToPath(location.uri)
      if (target) {
        results.push({
          uri: monaco.Uri.file(target),
          range: {
            startLineNumber: location.range.start.line + 1,
            startColumn: location.range.start.character + 1,
            endLineNumber: location.range.end.line + 1,
            endColumn: location.range.end.character + 1
          }
        })
      }
    }
  }
  return results.length > 0 ? results : null
}

function firstLine(): Monaco.IRange {
  return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
}

/**
 * Monaco asks an opener to show a resource other than the current model. Pod opens it
 * as a preview tab in the source editor's worktree and reveals the line.
 */
export function installPodDbtEditorOpener(monaco: MonacoModule): Monaco.IDisposable {
  return monaco.editor.registerEditorOpener({
    openCodeEditor: (source, resource, selectionOrPosition) => {
      const sourceModel = source.getModel()
      if (
        resource.scheme !== 'file' ||
        !sourceModel ||
        sourceModel.getLanguageId() !== JINJA_SQL_LANGUAGE_ID
      ) {
        return false
      }
      const sourcePath = sourceModel.uri.fsPath
      const state = useAppStore.getState()
      const owner = state.openFiles.find(
        (file) => file.filePath === sourcePath && file.mode === 'edit'
      )
      if (!owner) {
        return false
      }
      const root = worktreeRootOf(owner.filePath, owner.relativePath)
      const targetPath = resource.fsPath
      state.openFile(
        {
          filePath: targetPath,
          relativePath: relativeToRoot(root, targetPath),
          worktreeId: owner.worktreeId,
          runtimeEnvironmentId: owner.runtimeEnvironmentId,
          language: detectLanguage(targetPath),
          mode: 'edit'
        },
        {
          preview: true,
          targetGroupId: state.activeGroupIdByWorktree?.[owner.worktreeId],
          recordReplacedPreview: true
        }
      )
      const line = lineOf(selectionOrPosition)
      if (line) {
        const fileId = getOpenedEditFileIdAfterOpen(
          useAppStore.getState(),
          targetPath,
          owner.worktreeId
        )
        scheduleEditorLineReveal(useAppStore.getState, targetPath, line.line, line.column, fileId)
      }
      return true
    }
  })
}

function lineOf(
  selectionOrPosition: Monaco.IRange | Monaco.IPosition | undefined
): { line: number; column: number } | null {
  if (!selectionOrPosition) {
    return null
  }
  if ('startLineNumber' in selectionOrPosition) {
    return { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
  }
  return { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column }
}
