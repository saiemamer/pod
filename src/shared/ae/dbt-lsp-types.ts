/**
 * Pod: what crosses IPC between the Jinja SQL editor and the dbt language server.
 * Positions are LSP positions (zero-based line and character); the renderer converts
 * to Monaco's one-based form at the edge. Plain objects only, so they survive IPC.
 */
export type DbtLspPosition = { line: number; character: number }

export type DbtLspRange = { start: DbtLspPosition; end: DbtLspPosition }

export type DbtLspLocation = { uri: string; range: DbtLspRange }

export type DbtLspCompletionItem = {
  label: string
  /** LSP CompletionItemKind number; the renderer maps it to Monaco's enum. */
  kind?: number
  detail?: string
  documentation?: string
  insertText?: string
  sortText?: string
  filterText?: string
}

export type DbtLspHover = {
  /** Markdown or plain text; empty means nothing to show. */
  contents: string
  range?: DbtLspRange
}

export type DbtLspDiagnostic = {
  range: DbtLspRange
  /** LSP DiagnosticSeverity: 1 error, 2 warning, 3 information, 4 hint. */
  severity?: number
  message: string
  source?: string
  code?: string | number
}

export type DbtLspState = 'disabled' | 'unavailable' | 'starting' | 'running' | 'stopped' | 'error'

export type DbtLspStatus = {
  state: DbtLspState
  projectDir?: string
  /** Binary path and where it came from; never an env value. */
  binary?: string
  binarySource?: 'settings' | 'download' | 'path'
  serverVersion?: string
  /** One sentence for the Connection tab when the server is off or broke. */
  message?: string
  /** True while Pod is fetching the pinned release. */
  downloading?: boolean
}

export type DbtLspDocumentRequest = {
  /** Absolute file path; main resolves the project and picks the server. */
  path: string
}

export type DbtLspOpenRequest = DbtLspDocumentRequest & { text: string; version: number }

export type DbtLspChangeRequest = DbtLspDocumentRequest & { text: string; version: number }

export type DbtLspPositionRequest = DbtLspDocumentRequest & { position: DbtLspPosition }

export type DbtLspDiagnosticsEvent = { path: string; diagnostics: DbtLspDiagnostic[] }

export type DbtLspStatusEvent = DbtLspStatus & { projectDir: string }

export type DbtLspEvent =
  | { kind: 'diagnostics'; event: DbtLspDiagnosticsEvent }
  | { kind: 'status'; event: DbtLspStatusEvent }

/** Absolute path to a file: URI, the way Monaco and LSP servers spell it. */
export function dbtLspFileUri(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${encodeURI(withRoot).replace(/[?#]/g, (c) => encodeURIComponent(c))}`
}

/** The inverse of dbtLspFileUri for locations the server sends back. */
export function dbtLspUriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) {
    return null
  }
  let rest = uri.slice('file://'.length)
  if (rest.startsWith('/') === false) {
    return null
  }
  try {
    rest = decodeURIComponent(rest)
  } catch {
    return null
  }
  // Why: Windows URIs read file:///C:/x; the leading slash is not part of the path there.
  return /^\/[A-Za-z]:\//.test(rest) ? rest.slice(1) : rest
}
