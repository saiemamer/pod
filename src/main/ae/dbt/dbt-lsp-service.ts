import { dirname } from 'node:path'
import type { ProcessSpec } from '../../../shared/child-process/process-spec'
import {
  dbtLspFileUri,
  dbtLspUriToPath,
  type DbtLspChangeRequest,
  type DbtLspCompletionItem,
  type DbtLspDocumentRequest,
  type DbtLspEvent,
  type DbtLspHover,
  type DbtLspLocation,
  type DbtLspOpenRequest,
  type DbtLspPositionRequest,
  type DbtLspStatus
} from '../../../shared/ae/dbt-lsp-types'
import type { DbtContext } from './dbt-context'
import { DbtLspServer, type DbtLspChild } from './dbt-lsp-bridge'
import { resolveDbtLspBinary, type DbtLspBinary } from './dbt-lsp-binary'
import type { AeDbtService } from './dbt-service'

/**
 * Pod: one language server per dbt project, started when the first Jinja SQL editor in
 * that project opens and stopped a few minutes after the last one closes. Files
 * outside any project get `unavailable` and no process.
 */
export type DbtLspServiceDeps = {
  dbt: AeDbtService
  userData: () => string
  fetch: (url: string) => Promise<Response>
  emit: (event: DbtLspEvent) => void
  launch?: (spec: ProcessSpec) => DbtLspChild
  platform?: NodeJS.Platform
  arch?: string
  idleStopMs?: number
}

type ProjectEntry = {
  projectDir: string
  status: DbtLspStatus
  server: DbtLspServer | null
  starting: Promise<DbtLspServer | null> | null
  documents: Set<string>
  idleTimer: ReturnType<typeof setTimeout> | null
  failedAt: number
}

export const DBT_LSP_IDLE_STOP_MS = 5 * 60_000
const RETRY_AFTER_FAILURE_MS = 60_000

export class DbtLspService {
  private readonly entries = new Map<string, ProjectEntry>()
  /** Directory → project dir (or null outside a project), so one lookup per folder. */
  private readonly projectByDir = new Map<string, string | null>()

  constructor(private readonly deps: DbtLspServiceDeps) {}

  async status(request: DbtLspDocumentRequest): Promise<DbtLspStatus> {
    const entry = await this.entryFor(request.path)
    return entry ? entry.status : { state: 'unavailable', message: 'Not inside a dbt project.' }
  }

  async open(request: DbtLspOpenRequest): Promise<DbtLspStatus> {
    const entry = await this.entryFor(request.path)
    if (!entry) {
      return { state: 'unavailable', message: 'Not inside a dbt project.' }
    }
    const uri = dbtLspFileUri(request.path)
    entry.documents.add(uri)
    this.clearIdle(entry)
    const server = await this.ensureServer(entry)
    if (server && entry.documents.has(uri)) {
      server.didOpen(uri, request.text, request.version)
    }
    return entry.status
  }

  async change(request: DbtLspChangeRequest): Promise<void> {
    const entry = await this.entryFor(request.path)
    const server = entry?.server
    if (entry && server?.running) {
      server.didChange(dbtLspFileUri(request.path), request.text, request.version)
    }
  }

  async close(request: DbtLspDocumentRequest): Promise<void> {
    const entry = await this.entryFor(request.path)
    if (!entry) {
      return
    }
    const uri = dbtLspFileUri(request.path)
    entry.documents.delete(uri)
    entry.server?.didClose(uri)
    if (entry.documents.size === 0) {
      this.scheduleIdle(entry)
    }
  }

  async completion(request: DbtLspPositionRequest): Promise<DbtLspCompletionItem[]> {
    const server = await this.runningServer(request.path)
    return server ? server.completion(dbtLspFileUri(request.path), request.position) : []
  }

  async hover(request: DbtLspPositionRequest): Promise<DbtLspHover | null> {
    const server = await this.runningServer(request.path)
    return server ? server.hover(dbtLspFileUri(request.path), request.position) : null
  }

  async definition(request: DbtLspPositionRequest): Promise<DbtLspLocation[]> {
    const server = await this.runningServer(request.path)
    return server ? server.definition(dbtLspFileUri(request.path), request.position) : []
  }

  /** Stops and forgets the project's server; the next open starts a fresh one. */
  async restart(request: DbtLspDocumentRequest): Promise<DbtLspStatus> {
    const entry = await this.entryFor(request.path, true)
    if (!entry) {
      return { state: 'unavailable', message: 'Not inside a dbt project.' }
    }
    await this.stopEntry(entry)
    entry.failedAt = 0
    if (entry.documents.size > 0) {
      await this.ensureServer(entry)
    } else {
      this.setStatus(entry, { state: 'stopped', message: 'No Jinja SQL editor open.' })
    }
    return entry.status
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.stopEntry(entry)))
  }

  private async runningServer(path: string): Promise<DbtLspServer | null> {
    const entry = await this.entryFor(path)
    if (!entry) {
      return null
    }
    const server = entry.server?.running ? entry.server : await this.ensureServer(entry)
    return server?.running ? server : null
  }

  private async entryFor(path: string, refresh = false): Promise<ProjectEntry | null> {
    const dir = dirname(path)
    let projectDir = refresh ? undefined : this.projectByDir.get(dir)
    if (projectDir === undefined) {
      try {
        const context = await this.deps.dbt.resolve({ path })
        projectDir = context.project.projectDir
      } catch {
        projectDir = null
      }
      this.projectByDir.set(dir, projectDir)
    }
    if (projectDir === null) {
      return null
    }
    let entry = this.entries.get(projectDir)
    if (!entry) {
      entry = {
        projectDir,
        status: { state: 'stopped', projectDir },
        server: null,
        starting: null,
        documents: new Set(),
        idleTimer: null,
        failedAt: 0
      }
      this.entries.set(projectDir, entry)
    }
    return entry
  }

  private ensureServer(entry: ProjectEntry): Promise<DbtLspServer | null> {
    if (entry.server?.running) {
      return Promise.resolve(entry.server)
    }
    if (entry.starting) {
      return entry.starting
    }
    if (entry.failedAt && Date.now() - entry.failedAt < RETRY_AFTER_FAILURE_MS) {
      return Promise.resolve(null)
    }
    entry.starting = this.startServer(entry).finally(() => {
      entry.starting = null
    })
    return entry.starting
  }

  private async startServer(entry: ProjectEntry): Promise<DbtLspServer | null> {
    let context: DbtContext
    try {
      context = await this.deps.dbt.resolve({ path: entry.projectDir })
    } catch (error) {
      this.fail(entry, error)
      return null
    }
    if (!context.settings.lspEnabled) {
      this.setStatus(entry, { state: 'disabled', message: 'Turned off in Settings > dbt.' })
      return null
    }
    let binary: DbtLspBinary
    try {
      binary = await resolveDbtLspBinary(context, {
        userData: this.deps.userData(),
        fetch: this.deps.fetch,
        platform: this.deps.platform,
        arch: this.deps.arch,
        onProgress: (message) =>
          this.setStatus(entry, { state: 'starting', downloading: true, message })
      })
    } catch (error) {
      this.fail(entry, error)
      return null
    }
    // Why --fusion: the server runs Fusion's static analysis and reports it as diagnostics.
    const args =
      context.settings.distribution === 'fusion' && context.binary
        ? [`--fusion=${context.binary.path}`]
        : []
    this.setStatus(entry, {
      state: 'starting',
      binary: binary.path,
      binarySource: binary.source,
      downloading: false
    })
    const server = new DbtLspServer({
      binary: binary.path,
      args,
      projectDir: entry.projectDir,
      env: context.env,
      launch: this.deps.launch,
      onDiagnostics: (uri, diagnostics) => {
        const path = dbtLspUriToPath(uri)
        if (path) {
          this.deps.emit({ kind: 'diagnostics', event: { path, diagnostics } })
        }
      },
      onExit: (code, stderrTail) => {
        if (entry.server !== server) {
          return
        }
        entry.server = null
        if (entry.status.state === 'running' || entry.status.state === 'starting') {
          entry.failedAt = Date.now()
          this.setStatus(entry, {
            state: 'error',
            message: `dbt-language-server exited with code ${code ?? 'unknown'}${
              stderrTail ? `: ${stderrTail.split('\n').at(-1)}` : ''
            }`
          })
        }
      }
    })
    entry.server = server
    try {
      await server.start()
    } catch (error) {
      entry.server = null
      await server.stop()
      this.fail(entry, error)
      return null
    }
    this.setStatus(entry, {
      state: 'running',
      binary: binary.path,
      binarySource: binary.source,
      serverVersion: server.serverVersion,
      message: undefined
    })
    return server
  }

  private fail(entry: ProjectEntry, error: unknown): void {
    entry.failedAt = Date.now()
    this.setStatus(entry, {
      state: 'error',
      downloading: false,
      message: error instanceof Error ? error.message : String(error)
    })
  }

  private setStatus(entry: ProjectEntry, patch: Partial<DbtLspStatus>): void {
    entry.status = { ...entry.status, ...patch, projectDir: entry.projectDir }
    this.deps.emit({ kind: 'status', event: { ...entry.status, projectDir: entry.projectDir } })
  }

  private scheduleIdle(entry: ProjectEntry): void {
    this.clearIdle(entry)
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null
      if (entry.documents.size === 0) {
        void this.stopEntry(entry).then(() =>
          this.setStatus(entry, { state: 'stopped', message: 'Stopped after idling.' })
        )
      }
    }, this.deps.idleStopMs ?? DBT_LSP_IDLE_STOP_MS)
  }

  private clearIdle(entry: ProjectEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }
  }

  private async stopEntry(entry: ProjectEntry): Promise<void> {
    this.clearIdle(entry)
    const server = entry.server
    entry.server = null
    if (entry.starting) {
      await entry.starting.catch(() => null)
    }
    if (server) {
      await server.stop()
    }
  }
}
