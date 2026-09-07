import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { JINJA_SQL_LANGUAGE_ID } from '@/lib/monaco-languages/register-jinja-sql'
import type {
  DbtLspCompletionItem,
  DbtLspDiagnostic,
  DbtLspPosition,
  DbtLspRange
} from '../../../../shared/ae/dbt-lsp-types'
import { installPodDbtEditorOpener, providePodDbtDefinition } from './dbt-lsp-definition'

type MonacoModule = typeof Monaco

/**
 * Pod: wires Monaco's Jinja SQL editors to dbt-language-server through IPC. Hand-wired
 * (completion, hover, definition, diagnostics as markers) because monaco-languageclient
 * needs a vscode-api shim Orca does not carry. Installed once, on the first dock mount.
 */
export const POD_DBT_MARKER_OWNER = 'pod-dbt'
const CHANGE_DEBOUNCE_MS = 200

let installed = false
/** Paths main answered `unavailable` for (outside any project), so no further IPC. */
const unmanaged = new Set<string>()
const tracked = new Map<
  string,
  { model: Monaco.editor.ITextModel; timer: ReturnType<typeof setTimeout> | null }
>()

function api(): Window['api']['ae']['dbt'] | null {
  return typeof window !== 'undefined' && window.api?.ae?.dbt?.lsp ? window.api.ae.dbt : null
}

export function modelPath(model: Monaco.editor.ITextModel): string | null {
  return model.uri.scheme === 'file' ? model.uri.fsPath : null
}

export function toLspPosition(position: Monaco.IPosition): DbtLspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function toMonacoRange(range: DbtLspRange): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}

export async function ensurePodDbtLanguageClient(): Promise<void> {
  if (installed || !api()) {
    return
  }
  installed = true
  const { monaco } = await import('@/lib/monaco-setup')
  installProviders(monaco)
  installPodDbtEditorOpener(monaco)
  installDocumentSync(monaco)
  installEvents(monaco)
}

function installDocumentSync(monaco: MonacoModule): void {
  const consider = (model: Monaco.editor.ITextModel): void => {
    if (model.getLanguageId() === JINJA_SQL_LANGUAGE_ID) {
      track(model)
    }
    model.onDidChangeLanguage(() => {
      if (model.getLanguageId() === JINJA_SQL_LANGUAGE_ID) {
        track(model)
      } else {
        untrack(model)
      }
    })
    model.onWillDispose(() => untrack(model))
  }
  monaco.editor.getModels().forEach(consider)
  monaco.editor.onDidCreateModel(consider)
}

function track(model: Monaco.editor.ITextModel): void {
  const path = modelPath(model)
  const lsp = api()?.lsp
  if (!path || !lsp || tracked.has(path) || unmanaged.has(path)) {
    return
  }
  const entry = { model, timer: null as ReturnType<typeof setTimeout> | null }
  tracked.set(path, entry)
  void lsp.open({ path, text: model.getValue(), version: model.getVersionId() }).then(
    (status) => {
      useAppStore.getState().setAeDbtLspStatus?.(status)
      if (status.state === 'unavailable') {
        unmanaged.add(path)
        tracked.delete(path)
      }
    },
    () => tracked.delete(path)
  )
  model.onDidChangeContent(() => {
    if (!tracked.has(path)) {
      return
    }
    if (entry.timer) {
      clearTimeout(entry.timer)
    }
    entry.timer = setTimeout(() => {
      entry.timer = null
      void lsp.change({ path, text: model.getValue(), version: model.getVersionId() })
    }, CHANGE_DEBOUNCE_MS)
  })
}

function untrack(model: Monaco.editor.ITextModel): void {
  const path = modelPath(model)
  const entry = path ? tracked.get(path) : undefined
  if (!path || !entry) {
    return
  }
  if (entry.timer) {
    clearTimeout(entry.timer)
  }
  tracked.delete(path)
  void api()?.lsp.close({ path })
}

function installEvents(monaco: MonacoModule): void {
  api()?.lsp.onEvent((event) => {
    if (event.kind === 'status') {
      useAppStore.getState().setAeDbtLspStatus?.(event.event)
      return
    }
    const entry = tracked.get(event.event.path)
    if (entry) {
      monaco.editor.setModelMarkers(
        entry.model,
        POD_DBT_MARKER_OWNER,
        event.event.diagnostics.map((diagnostic) => toMarker(monaco, diagnostic))
      )
    }
  })
}

function toMarker(monaco: MonacoModule, diagnostic: DbtLspDiagnostic): Monaco.editor.IMarkerData {
  const severity = {
    1: monaco.MarkerSeverity.Error,
    2: monaco.MarkerSeverity.Warning,
    3: monaco.MarkerSeverity.Info,
    4: monaco.MarkerSeverity.Hint
  }[diagnostic.severity ?? 1]
  return {
    ...toMonacoRange(diagnostic.range),
    severity: severity ?? monaco.MarkerSeverity.Error,
    message: diagnostic.message,
    source: diagnostic.source ?? 'dbt',
    ...(diagnostic.code !== undefined ? { code: String(diagnostic.code) } : {})
  }
}

/** LSP CompletionItemKind numbers → Monaco's enum, which is ordered differently. */
const COMPLETION_KINDS: Record<number, keyof typeof Monaco.languages.CompletionItemKind> = {
  1: 'Text',
  2: 'Method',
  3: 'Function',
  4: 'Constructor',
  5: 'Field',
  6: 'Variable',
  7: 'Class',
  8: 'Interface',
  9: 'Module',
  10: 'Property',
  11: 'Unit',
  12: 'Value',
  13: 'Enum',
  14: 'Keyword',
  15: 'Snippet',
  16: 'Color',
  17: 'File',
  18: 'Reference',
  19: 'Folder',
  20: 'EnumMember',
  21: 'Constant',
  22: 'Struct',
  23: 'Event',
  24: 'Operator',
  25: 'TypeParameter'
}

export function toMonacoCompletion(
  monaco: MonacoModule,
  item: DbtLspCompletionItem,
  range: Monaco.IRange
): Monaco.languages.CompletionItem {
  const kindName = item.kind !== undefined ? COMPLETION_KINDS[item.kind] : undefined
  return {
    label: item.label,
    kind: monaco.languages.CompletionItemKind[kindName ?? 'Text'],
    insertText: item.insertText ?? item.label,
    range,
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.documentation ? { documentation: { value: item.documentation } } : {}),
    ...(item.sortText ? { sortText: item.sortText } : {}),
    ...(item.filterText ? { filterText: item.filterText } : {})
  }
}

function installProviders(monaco: MonacoModule): void {
  monaco.languages.registerCompletionItemProvider(JINJA_SQL_LANGUAGE_ID, {
    triggerCharacters: ["'", '"', '(', '.', ' '],
    provideCompletionItems: async (model, position) => {
      const path = modelPath(model)
      const dbt = api()
      if (!path || !dbt || !tracked.has(path)) {
        return { suggestions: [] }
      }
      // Why swallow: a server mid-restart must not surface as an editor error; the word list still shows.
      const items = await dbt.lsp
        .completion({ path, position: toLspPosition(position) })
        .catch((): DbtLspCompletionItem[] => [])
      const word = model.getWordUntilPosition(position)
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }
      return { suggestions: items.map((item) => toMonacoCompletion(monaco, item, range)) }
    }
  })
  monaco.languages.registerHoverProvider(JINJA_SQL_LANGUAGE_ID, {
    provideHover: async (model, position) => {
      const path = modelPath(model)
      const dbt = api()
      if (!path || !dbt || !tracked.has(path)) {
        return null
      }
      const hover = await dbt.lsp.hover({ path, position: toLspPosition(position) })
      if (!hover) {
        return null
      }
      return {
        contents: [{ value: hover.contents }],
        ...(hover.range ? { range: toMonacoRange(hover.range) } : {})
      }
    }
  })
  monaco.languages.registerDefinitionProvider(JINJA_SQL_LANGUAGE_ID, {
    provideDefinition: (model, position) =>
      providePodDbtDefinition(monaco, model, position, {
        lspReady: (path) => tracked.has(path)
      })
  })
}
