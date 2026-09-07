import type { AeDomainConfig, AeDomainRepo, AeInitiative } from '../../shared/ae/domain-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type {
  DbtCompileRequest,
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
  }
  onChanged: (callback: () => void) => () => void
}
