import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection
} from 'vscode-jsonrpc/node'
import { spawnProcess } from '../../../shared/child-process/run-process'
import type { ProcessSpec } from '../../../shared/child-process/process-spec'
import {
  dbtLspFileUri,
  type DbtLspCompletionItem,
  type DbtLspDiagnostic,
  type DbtLspHover,
  type DbtLspLocation,
  type DbtLspPosition
} from '../../../shared/ae/dbt-lsp-types'
import {
  asRecord,
  hoverText,
  isPresent,
  toCompletionItem,
  toDiagnostics,
  toLocation,
  toRange
} from './dbt-lsp-convert'

/**
 * Pod: one dbt-language-server process for one dbt project, spoken to over stdio with
 * LSP framing. Hand-wired rather than monaco-languageclient, which needs a vscode-api
 * shim Orca's Monaco does not carry. Never sends workspace/didChangeConfiguration: the
 * server reads dbt_project.yml itself.
 */
export type DbtLspServerOptions = {
  binary: string
  args?: string[]
  projectDir: string
  env?: NodeJS.ProcessEnv
  onDiagnostics?: (uri: string, diagnostics: DbtLspDiagnostic[]) => void
  onExit?: (code: number | null, stderrTail: string) => void
  spawn?: (spec: ProcessSpec) => ChildProcessWithoutNullStreams
  requestTimeoutMs?: number
}

export const DBT_LSP_REQUEST_TIMEOUT_MS = 10_000
const STDERR_TAIL_LINES = 20

export class DbtLspServer {
  private child: ChildProcessWithoutNullStreams | null = null
  private connection: MessageConnection | null = null
  private stderrTail: string[] = []
  private readonly openUris = new Set<string>()
  private exited = false
  serverVersion: string | undefined

  constructor(private readonly options: DbtLspServerOptions) {}

  get running(): boolean {
    return this.connection !== null && !this.exited
  }

  get openDocumentCount(): number {
    return this.openUris.size
  }

  async start(): Promise<void> {
    const spawn = this.options.spawn ?? spawnProcess
    const child = spawn({
      program: this.options.binary,
      args: this.options.args ?? [],
      cwd: this.options.projectDir,
      env: this.options.env ?? process.env,
      timeoutMs: null
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) {
          this.stderrTail.push(line)
        }
      }
      this.stderrTail = this.stderrTail.slice(-STDERR_TAIL_LINES)
    })
    // Why: the caller owns stream errors; an unhandled EPIPE on stdin would take main down.
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', () => {})
    }
    child.on('exit', (code) => this.handleExit(code))
    child.on('error', (error) => {
      this.stderrTail.push(error.message)
      this.handleExit(null)
    })
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
      { error: () => {}, warn: () => {}, info: () => {}, log: () => {} }
    )
    connection.onNotification('textDocument/publishDiagnostics', (params: unknown) => {
      const record = asRecord(params)
      const uri = typeof record.uri === 'string' ? record.uri : null
      if (uri) {
        this.options.onDiagnostics?.(uri, toDiagnostics(record.diagnostics))
      }
    })
    // Why answer these: a server that registers capabilities or asks for settings blocks
    // on the reply; null tells it Pod has nothing to add.
    connection.onRequest('client/registerCapability', () => null)
    connection.onRequest('client/unregisterCapability', () => null)
    connection.onRequest('workspace/configuration', (params: unknown) => {
      const items = asRecord(params).items
      return Array.isArray(items) ? items.map(() => null) : []
    })
    connection.onRequest('window/workDoneProgress/create', () => null)
    // Why swallow: a write to a dead child reports through onError; the exit handler below
    // is what tells the caller, with the real exit code and stderr.
    connection.onError(() => {})
    // Why not exit here: stdout closes before the process reports its code; kill the
    // child if it is somehow still alive and let the 'exit' event finish the job.
    connection.onClose(() => {
      if (this.child && this.child.exitCode === null && !this.child.killed) {
        this.child.kill('SIGTERM')
      }
    })
    connection.listen()
    this.connection = connection
    const rootUri = dbtLspFileUri(this.options.projectDir)
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri,
      rootPath: this.options.projectDir,
      workspaceFolders: [
        { uri: rootUri, name: this.options.projectDir.split('/').at(-1) ?? 'dbt' }
      ],
      clientInfo: { name: 'pod', version: '0' },
      capabilities: {
        textDocument: {
          synchronization: { didSave: false, willSave: false },
          completion: {
            completionItem: {
              snippetSupport: false,
              documentationFormat: ['markdown', 'plaintext']
            }
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: {},
          publishDiagnostics: {}
        },
        workspace: { configuration: false, workspaceFolders: true }
      }
    })
    const info = asRecord(asRecord(result).serverInfo)
    this.serverVersion = typeof info.version === 'string' ? info.version : undefined
    this.notify('initialized', {})
  }

  didOpen(uri: string, text: string, version: number): void {
    this.openUris.add(uri)
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'sql', version, text }
    })
  }

  /** Whole-document change: the server declares incremental sync but accepts full text. */
  didChange(uri: string, text: string, version: number): void {
    if (!this.openUris.has(uri)) {
      this.didOpen(uri, text, version)
      return
    }
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    })
  }

  didClose(uri: string): void {
    if (this.openUris.delete(uri)) {
      this.notify('textDocument/didClose', { textDocument: { uri } })
    }
  }

  async completion(uri: string, position: DbtLspPosition): Promise<DbtLspCompletionItem[]> {
    const result = await this.request('textDocument/completion', {
      textDocument: { uri },
      position
    })
    const items = Array.isArray(result) ? result : asRecord(result).items
    return Array.isArray(items) ? items.map(toCompletionItem).filter(isPresent) : []
  }

  async hover(uri: string, position: DbtLspPosition): Promise<DbtLspHover | null> {
    const result = await this.request('textDocument/hover', { textDocument: { uri }, position })
    const record = asRecord(result)
    const contents = hoverText(record.contents)
    if (!contents) {
      return null
    }
    const range = toRange(record.range)
    return range ? { contents, range } : { contents }
  }

  async definition(uri: string, position: DbtLspPosition): Promise<DbtLspLocation[]> {
    const result = await this.request('textDocument/definition', {
      textDocument: { uri },
      position
    })
    const entries = Array.isArray(result) ? result : result ? [result] : []
    return entries.map(toLocation).filter(isPresent)
  }

  async stop(): Promise<void> {
    const connection = this.connection
    if (!connection || this.exited) {
      this.kill()
      return
    }
    try {
      await Promise.race([
        connection.sendRequest('shutdown', null),
        new Promise((resolve) => setTimeout(resolve, 2_000))
      ])
      this.notify('exit', null)
    } catch {
      // Why: a server mid-crash cannot answer; the kill below settles it.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    this.kill()
  }

  stderrText(): string {
    return this.stderrTail.join('\n')
  }

  private notify(method: string, params: unknown): void {
    if (this.connection && !this.exited) {
      void this.connection.sendNotification(method, params).catch(() => {})
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const connection = this.connection
    if (!connection || this.exited) {
      return Promise.reject(new Error('dbt-language-server is not running'))
    }
    const timeoutMs = this.options.requestTimeoutMs ?? DBT_LSP_REQUEST_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`dbt-language-server did not answer ${method} in ${timeoutMs / 1000}s`)),
        timeoutMs
      )
      connection.sendRequest(method, params).then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
    })
  }

  private handleExit(code: number | null): void {
    if (this.exited) {
      return
    }
    this.exited = true
    this.openUris.clear()
    this.connection?.dispose()
    this.connection = null
    this.options.onExit?.(code, this.stderrText())
  }

  private kill(): void {
    const child = this.child
    if (child && child.exitCode === null && !child.killed) {
      child.kill('SIGTERM')
    }
    if (!child || child.exitCode !== null) {
      this.handleExit(child?.exitCode ?? null)
    }
  }
}
