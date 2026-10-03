import type {
  OmniBranch,
  OmniCommitResult,
  OmniModel,
  OmniTopicDetail,
  OmniTopicRelationship,
  OmniTopicSummary,
  OmniTopicView,
  OmniValidationIssue
} from '../../../shared/ae/omni-types'

/**
 * Pod: the Omni CLI commands Pod runs and readers for what they print. The CLI is
 * generated from Omni's OpenAPI spec: path parameters are positional, query parameters
 * are kebab-case flags, request bodies go through `--body`. Readers accept missing
 * fields because the spec and the API docs disagree in places (validate is one).
 */
export function listModelsArgs(options: {
  modelId?: string
  withBranches?: boolean
  cursor?: string
}): string[] {
  const args = ['models', 'list', '--page-size', '100']
  if (options.cursor) {
    args.push('--cursor', options.cursor)
  }
  if (options.modelId) {
    args.push('--model-id', options.modelId)
  }
  if (options.withBranches) {
    args.push('--include', 'activeBranches')
  }
  return args
}

export function createBranchArgs(modelId: string, name: string): string[] {
  return ['models', 'create-branch', modelId, '--name', name]
}

export function validateArgs(modelId: string, branchId: string | null): string[] {
  return branchId
    ? ['models', 'validate', modelId, '--branch-id', branchId]
    : ['models', 'validate', modelId]
}

export function commitArgs(modelId: string, branchId: string, message: string): string[] {
  return [
    'models',
    'commit',
    modelId,
    '--body',
    JSON.stringify({ branch_id: branchId, commit_message: message })
  ]
}

export function listTopicsArgs(modelId: string, branchId: string | null): string[] {
  return withBranch(['models', 'list-topics', modelId], branchId)
}

export function getTopicArgs(modelId: string, topic: string, branchId: string | null): string[] {
  return withBranch(['models', 'get-topic', modelId, topic], branchId)
}

function withBranch(args: string[], branchId: string | null): string[] {
  return branchId ? [...args, '--branch-id', branchId] : args
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function records(json: unknown): Record<string, unknown>[] {
  const list = isRecord(json) ? json.records : json
  return Array.isArray(list) ? list.filter(isRecord) : []
}

export function parseOmniModels(json: unknown): OmniModel[] {
  return records(json)
    .map((record) => ({
      id: str(record.id) ?? '',
      name: str(record.name) ?? null,
      modelKind: str(record.modelKind) ?? null,
      connectionId: str(record.connectionId) ?? null,
      updatedAt: str(record.updatedAt) ?? null
    }))
    .filter((model) => model.id.length > 0)
}

/** The cursor for the next page of `models list`, or null on the last page. */
export function parseOmniNextCursor(json: unknown): string | null {
  const pageInfo = isRecord(json) && isRecord(json.pageInfo) ? json.pageInfo : null
  return pageInfo?.hasNextPage === true ? (str(pageInfo.nextCursor) ?? null) : null
}

/** Active branches of one model, from `models list --model-id <id> --include activeBranches`. */
export function parseOmniBranches(json: unknown, modelId: string): OmniBranch[] {
  const list = records(json)
  // Why no fallback to the first record: its branch ids belong to another model.
  const record = list.find((entry) => entry.id === modelId)
  const branches = Array.isArray(record?.branches) ? record.branches.filter(isRecord) : []
  return branches
    .map((branch) => ({ id: str(branch.id) ?? '', name: str(branch.name) ?? '' }))
    .filter((branch) => branch.id && branch.name)
}

export function parseCreatedBranch(json: unknown, name: string): OmniBranch {
  const model = isRecord(json) && isRecord(json.model) ? json.model : null
  const id = str(model?.id)
  if (!id) {
    const message = isRecord(json) ? (str(json.message) ?? str(json.error)) : undefined
    throw new Error(message ?? 'omni create-branch returned no branch id')
  }
  return { id, name: str(model?.name) ?? name }
}

/**
 * Two shapes are in the wild: the CLI's spec answers `{ valid, issues: [{ message,
 * severity, view, field }] }`, the API docs a bare array of `{ message, is_warning,
 * yaml_path, auto_fix }`.
 */
export function parseOmniValidation(json: unknown): {
  valid: boolean
  issues: OmniValidationIssue[]
} {
  const rawIssues = Array.isArray(json) ? json : isRecord(json) ? json.issues : []
  const issues = (Array.isArray(rawIssues) ? rawIssues : []).filter(isRecord).map(readIssue)
  const declared = isRecord(json) && typeof json.valid === 'boolean' ? json.valid : null
  return {
    valid: declared ?? !issues.some((issue) => issue.severity === 'error'),
    issues
  }
}

function readIssue(raw: Record<string, unknown>): OmniValidationIssue {
  const warning = raw.severity === 'warning' || raw.is_warning === true
  const autoFix = isRecord(raw.auto_fix) ? str(raw.auto_fix.description_short) : undefined
  const view = str(raw.view)
  const field = str(raw.field)
  const yamlPath = str(raw.yaml_path)
  return {
    message: str(raw.message) ?? 'Unnamed validation issue',
    severity: warning ? 'warning' : 'error',
    ...(view ? { view } : {}),
    ...(field ? { field } : {}),
    ...(yamlPath ? { yamlPath } : {}),
    ...(autoFix ? { autoFix } : {})
  }
}

export function parseOmniCommit(
  json: unknown,
  base: { modelId: string; branch: OmniBranch; message: string }
): OmniCommitResult {
  const body = isRecord(json) ? json : {}
  return {
    ...base,
    gitSha: str(body.git_sha) ?? null,
    prUrl: str(body.pr_url) ?? null,
    inSync: body.in_sync === true,
    didSync: body.did_sync === true
  }
}

function readTopicSummary(raw: Record<string, unknown>): OmniTopicSummary {
  const label = str(raw.label)
  const description = str(raw.description)
  const baseView = str(raw.base_view_name)
  const groupLabel = str(raw.group_label)
  return {
    name: str(raw.name) ?? '',
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(baseView ? { baseView } : {}),
    ...(groupLabel ? { groupLabel } : {}),
    hidden: raw.hidden === true,
    composite: raw.is_composite === true
  }
}

export function parseOmniTopics(json: unknown): OmniTopicSummary[] {
  const list = isRecord(json) ? json.topics : json
  return (Array.isArray(list) ? list : [])
    .filter(isRecord)
    .map(readTopicSummary)
    .filter((topic) => topic.name.length > 0)
    .sort((a, b) => (a.label ?? a.name).localeCompare(b.label ?? b.name))
}

function fieldNames(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => (isRecord(entry) ? str(entry.field_name) : str(entry)))
    .filter((name): name is string => Boolean(name))
}

export function parseOmniTopic(
  json: unknown,
  base: Pick<OmniTopicDetail, 'modelId' | 'branch'>
): OmniTopicDetail {
  const topic = isRecord(json) && isRecord(json.topic) ? json.topic : null
  if (!topic) {
    throw new Error('omni get-topic returned no topic')
  }
  const views: OmniTopicView[] = (Array.isArray(topic.views) ? topic.views : [])
    .filter(isRecord)
    .map((view) => {
      const label = str(view.label)
      return {
        name: str(view.name) ?? '',
        ...(label ? { label } : {}),
        dimensions: fieldNames(view.dimensions),
        measures: fieldNames(view.measures)
      }
    })
    .filter((view) => view.name.length > 0)
  const relationships: OmniTopicRelationship[] = (
    Array.isArray(topic.relationships) ? topic.relationships : []
  )
    .filter(isRecord)
    .map((rel) => {
      const joinType = str(rel.join_type)
      const relationship = str(rel.type)
      return {
        left: str(rel.left_view_alias) ?? str(rel.left_view_name) ?? '',
        right: str(rel.right_view_alias) ?? str(rel.right_view_name) ?? '',
        ...(joinType ? { joinType } : {}),
        ...(relationship ? { relationship } : {})
      }
    })
  return { ...readTopicSummary(topic), ...base, views, relationships }
}
