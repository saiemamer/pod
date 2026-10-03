import type { AeRepoRole } from './domain-types'

/**
 * Pod: what the Omni panel, `orca omni` and agents exchange with the main process. Every
 * request names a path inside a worktree; the main process finds the repo, its domain
 * env and the git branch, which is also the Omni model branch name.
 */
export type OmniPathRequest = {
  path: string
  /** Overrides OMNI_MODEL_ID from the domain env or the environment. */
  modelId?: string
}

export type OmniBranchRequest = OmniPathRequest & { create?: boolean }

export type OmniCommitRequest = OmniPathRequest & { message: string }

export type OmniTopicRequest = OmniPathRequest & { topic: string }

export type OmniBinarySource = 'settings' | 'path'

export type OmniBinary = {
  path: string
  source: OmniBinarySource
}

export type OmniModelIdSource = 'request' | 'domain' | 'environment'

/** What leaves the main process: env names, never values, except the base URL. */
export type OmniContextSummary = {
  repoRoot: string | null
  worktree: { id: string; repoId: string; path: string } | null
  domainId: string | null
  role: AeRepoRole | null
  binary: OmniBinary | null
  /** The worktree's git branch; Pod names the Omni model branch after it. */
  gitBranch: string | null
  modelId: string | null
  modelIdSource: OmniModelIdSource | null
  baseUrl: string | null
  /** Which env name carries the API token, if any. The Omni CLI's own profile may also hold one. */
  tokenEnv: 'OMNI_API_TOKEN' | 'OMNI_API_KEY' | null
}

export type OmniModel = {
  id: string
  name: string | null
  modelKind: string | null
  connectionId: string | null
  updatedAt: string | null
}

export type OmniModelsResult = {
  context: OmniContextSummary
  models: OmniModel[]
  /** More pages remained after Pod's cap of 1,000 models. */
  truncated: boolean
}

export type OmniBranch = {
  id: string
  name: string
}

export type OmniBranchResult = {
  context: OmniContextSummary
  modelId: string
  branchName: string
  /** The model branch named after the worktree's git branch, or null when there is none yet. */
  branch: OmniBranch | null
  created: boolean
  branches: OmniBranch[]
}

export type OmniIssueSeverity = 'error' | 'warning'

export type OmniValidationIssue = {
  message: string
  severity: OmniIssueSeverity
  view?: string
  field?: string
  yamlPath?: string
  autoFix?: string
}

export type OmniValidateResult = {
  modelId: string
  branch: OmniBranch | null
  /** `branch` when the worktree's model branch exists, else the shared model itself. */
  target: 'branch' | 'model'
  valid: boolean
  errors: number
  warnings: number
  issues: OmniValidationIssue[]
  durationMs: number
}

export type OmniCommitResult = {
  modelId: string
  branch: OmniBranch
  message: string
  gitSha: string | null
  prUrl: string | null
  inSync: boolean
  didSync: boolean
}

export type OmniTopicSummary = {
  name: string
  label?: string
  description?: string
  baseView?: string
  groupLabel?: string
  hidden: boolean
  composite: boolean
}

export type OmniTopicsResult = {
  modelId: string
  branch: OmniBranch | null
  topics: OmniTopicSummary[]
}

export type OmniTopicView = {
  name: string
  label?: string
  dimensions: string[]
  measures: string[]
}

export type OmniTopicRelationship = {
  left: string
  right: string
  joinType?: string
  relationship?: string
}

export type OmniTopicDetail = OmniTopicSummary & {
  modelId: string
  branch: OmniBranch | null
  views: OmniTopicView[]
  relationships: OmniTopicRelationship[]
}
