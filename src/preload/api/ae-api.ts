import type { AeDomainConfig, AeDomainRepo, AeInitiative } from '../../shared/ae/domain-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type {
  DbtLspChangeRequest,
  DbtLspCompletionItem,
  DbtLspDocumentRequest,
  DbtLspEvent,
  DbtLspHover,
  DbtLspLocation,
  DbtLspOpenRequest,
  DbtLspPositionRequest,
  DbtLspStatus
} from '../../shared/ae/dbt-lsp-types'
import type {
  DbtCatalogTree,
  DbtColumnLineageRequest,
  DbtColumnLineageResult,
  DbtGraphRequest,
  DbtGraphResult,
  DbtLineageEngineStatus
} from '../../shared/ae/dbt-graph-types'
import type {
  DbtCatalogRequest,
  DbtCatalogResult,
  DbtCompileRequest,
  DbtExportCsvRequest,
  DbtExportCsvResult,
  DbtResolveRefRequest,
  DbtResolveRefResult,
  DbtCompileResult,
  DbtContextSummary,
  DbtLineageRequest,
  DbtLineageResult,
  DbtListModelsRequest,
  DbtListModelsResult,
  DbtModelInfo,
  DbtModelRequest,
  DbtParseRequest,
  DbtParseResult,
  DbtPathRequest,
  DbtShowRequest,
  DbtShowResult
} from '../../shared/ae/dbt-types'

/** Pod: domains (folders of repos with roles) and initiatives (cross-repo runs). */
export type AeApi = {
  domains: {
    list: () => Promise<AeDomainConfig[]>
    save: (input: Partial<AeDomainConfig> & { id: string }) => Promise<AeDomainConfig>
    remove: (args: { domainId: string }) => Promise<void>
    detectRoles: (args: { groupId: string }) => Promise<AeDomainRepo[]>
    setSecret: (args: { domainId: string; name: string; value: string }) => Promise<void>
    removeSecret: (args: { domainId: string; name: string }) => Promise<void>
    openMainAgent: (args: {
      domainId: string
      agent?: TuiAgent
    }) => Promise<{ workspaceKey: string; reused: boolean }>
  }
  initiatives: {
    list: (args?: { domainId?: string }) => Promise<AeInitiative[]>
    save: (
      input: Partial<AeInitiative> & { domainId: string; title: string }
    ) => Promise<AeInitiative>
    remove: (args: { initiativeId: string }) => Promise<void>
    launch: (args: {
      domainId: string
      title: string
      stakeholderTeam?: string
      agent?: TuiAgent
      repoIds?: string[]
    }) => Promise<AeInitiative>
  }
  /** dbt for the editor: every call names a path inside the project; env values stay in main. */
  dbt: {
    project: (args: DbtPathRequest) => Promise<DbtContextSummary>
    show: (args: DbtShowRequest) => Promise<DbtShowResult>
    compile: (args: DbtCompileRequest) => Promise<DbtCompileResult>
    parse: (args: DbtParseRequest) => Promise<DbtParseResult>
    listModels: (args: DbtListModelsRequest) => Promise<DbtListModelsResult>
    modelInfo: (args: DbtModelRequest) => Promise<DbtModelInfo>
    lineage: (args: DbtLineageRequest) => Promise<DbtLineageResult>
    ensureCatalog: (args: DbtCatalogRequest) => Promise<DbtCatalogResult>
    resolveRef: (args: DbtResolveRefRequest) => Promise<DbtResolveRefResult>
    exportCsv: (args: DbtExportCsvRequest) => Promise<DbtExportCsvResult>
    /** Lineage graph around a model, from manifest and catalog on disk. */
    graph: (args: DbtGraphRequest) => Promise<DbtGraphResult>
    columnLineage: (args: DbtColumnLineageRequest) => Promise<DbtColumnLineageResult>
    catalogTree: (args: DbtPathRequest) => Promise<DbtCatalogTree>
    lineageEngine: (args: DbtPathRequest) => Promise<DbtLineageEngineStatus>
    /** dbt-language-server, one per project; documents are keyed by absolute path. */
    lsp: {
      status: (args: DbtLspDocumentRequest) => Promise<DbtLspStatus>
      open: (args: DbtLspOpenRequest) => Promise<DbtLspStatus>
      change: (args: DbtLspChangeRequest) => Promise<void>
      close: (args: DbtLspDocumentRequest) => Promise<void>
      completion: (args: DbtLspPositionRequest) => Promise<DbtLspCompletionItem[]>
      hover: (args: DbtLspPositionRequest) => Promise<DbtLspHover | null>
      definition: (args: DbtLspPositionRequest) => Promise<DbtLspLocation[]>
      restart: (args: DbtLspDocumentRequest) => Promise<DbtLspStatus>
      onEvent: (callback: (event: DbtLspEvent) => void) => () => void
    }
  }
  onChanged: (callback: () => void) => () => void
}
