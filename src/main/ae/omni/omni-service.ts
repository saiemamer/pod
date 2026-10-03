import { dirname, resolve } from 'node:path'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AeDomainService } from '../domain-service'
import { normalizeAeToolCmdOverrides } from '../../../shared/ae/dbt-settings-types'
import type {
  OmniBranch,
  OmniBranchRequest,
  OmniBranchResult,
  OmniCommitRequest,
  OmniCommitResult,
  OmniContextSummary,
  OmniModel,
  OmniModelsResult,
  OmniPathRequest,
  OmniTopicDetail,
  OmniTopicRequest,
  OmniTopicsResult,
  OmniValidateResult
} from '../../../shared/ae/omni-types'
import { findGitRoot, findManagedWorktreeForPath, isDirectory } from '../worktree-for-path'
import {
  OmniCliError,
  omniTokenEnv,
  resolveOmniBinary,
  runOmniJson,
  type OmniRunDeps
} from './omni-runner'
import {
  commitArgs,
  createBranchArgs,
  getTopicArgs,
  listModelsArgs,
  listTopicsArgs,
  parseCreatedBranch,
  parseOmniBranches,
  parseOmniCommit,
  parseOmniModels,
  parseOmniNextCursor,
  parseOmniTopic,
  parseOmniTopics,
  parseOmniValidation,
  validateArgs
} from './omni-branches'

export type OmniServiceDeps = {
  store: Store
  runtime: OrcaRuntimeService
  domains: AeDomainService | null
  env?: NodeJS.ProcessEnv
}

/** Resolved once per call. `env` stays in the main process; `summary` is what leaves it. */
export type OmniContext = {
  summary: OmniContextSummary
  cwd: string
  env: NodeJS.ProcessEnv
}

export const OMNI_MODEL_ENV = 'OMNI_MODEL_ID'
const OMNI_MODEL_PAGE_LIMIT = 10

/**
 * Pod: Omni model branches, validation, commits and topics for the worktree a path sits
 * in. The panel, `orca omni` and agents go through this one service, so the branch
 * Pod looks for is always the one named after the worktree's git branch.
 */
export class AeOmniService {
  constructor(
    private readonly deps: OmniServiceDeps,
    private readonly runDeps?: OmniRunDeps
  ) {}

  async resolve(request: OmniPathRequest): Promise<OmniContext> {
    const path = resolve(request.path)
    const worktree = await findManagedWorktreeForPath(this.deps.runtime, path)
    const repoRoot = worktree?.path ?? findGitRoot(path)
    const overrides = normalizeAeToolCmdOverrides(this.deps.store.getSettings().toolCmdOverrides)
    const owner =
      worktree && this.deps.domains ? this.deps.domains.roleForRepo(worktree.repoId) : null
    const domainEnv =
      owner && this.deps.domains
        ? { ...owner.domain.env, ...this.deps.domains.readSecrets(owner.domain.id) }
        : {}
    const baseEnv = this.deps.env ?? process.env
    // Why this order: what someone typed into Pod's domain beats the inherited environment.
    const env: NodeJS.ProcessEnv = { ...baseEnv, ...domainEnv }
    const requested = request.modelId?.trim()
    const fromDomain = domainEnv[OMNI_MODEL_ENV]?.trim()
    const fromEnv = baseEnv[OMNI_MODEL_ENV]?.trim()
    const modelId = requested || fromDomain || fromEnv || null
    const modelIdSource = requested
      ? 'request'
      : fromDomain
        ? 'domain'
        : fromEnv
          ? 'environment'
          : null
    return {
      summary: {
        repoRoot,
        worktree: worktree
          ? { id: worktree.id, repoId: worktree.repoId, path: worktree.path }
          : null,
        domainId: owner?.domain.id ?? null,
        role: owner?.role ?? null,
        binary: resolveOmniBinary(overrides.omni, env),
        gitBranch: worktree?.branch ?? null,
        modelId,
        modelIdSource,
        baseUrl: env.OMNI_BASE_URL?.trim() || null,
        tokenEnv: omniTokenEnv(env)
      },
      cwd: repoRoot ?? (isDirectory(path) ? path : dirname(path)),
      env
    }
  }

  async context(request: OmniPathRequest): Promise<OmniContextSummary> {
    return (await this.resolve(request)).summary
  }

  async models(request: OmniPathRequest): Promise<OmniModelsResult> {
    const context = await this.resolve(request)
    const models: OmniModel[] = []
    let cursor: string | undefined
    // Why a cap: ten pages of 100 cover any real org; a cursor that never ends must not hang the picker.
    for (let page = 0; page < OMNI_MODEL_PAGE_LIMIT; page += 1) {
      const json = await this.run(context, listModelsArgs({ cursor }))
      models.push(...parseOmniModels(json))
      cursor = parseOmniNextCursor(json) ?? undefined
      if (!cursor) {
        return { context: context.summary, models, truncated: false }
      }
    }
    return { context: context.summary, models, truncated: true }
  }

  /** The model branch named after the worktree's git branch; created when `create` is set. */
  async branch(request: OmniBranchRequest): Promise<OmniBranchResult> {
    const context = await this.resolve(request)
    const modelId = requireModelId(context)
    const branchName = requireBranchName(context)
    const branches = await this.listBranches(context, modelId)
    let branch = branches.find((entry) => entry.name === branchName) ?? null
    let created = false
    if (!branch && request.create) {
      branch = parseCreatedBranch(
        await this.run(context, createBranchArgs(modelId, branchName)),
        branchName
      )
      created = true
      branches.push(branch)
    }
    return { context: context.summary, modelId, branchName, branch, created, branches }
  }

  async validate(request: OmniPathRequest): Promise<OmniValidateResult> {
    const context = await this.resolve(request)
    const modelId = requireModelId(context)
    const branch = await this.currentBranch(context, modelId)
    const started = Date.now()
    const json = await this.run(context, validateArgs(modelId, branch?.id ?? null))
    const { valid, issues } = parseOmniValidation(json)
    return {
      modelId,
      branch,
      target: branch ? 'branch' : 'model',
      valid,
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      issues,
      durationMs: Date.now() - started
    }
  }

  async commit(request: OmniCommitRequest): Promise<OmniCommitResult> {
    const message = request.message.trim()
    if (!message) {
      throw new Error('A commit message is required.')
    }
    const context = await this.resolve(request)
    const modelId = requireModelId(context)
    const branch = await this.currentBranch(context, modelId)
    if (!branch) {
      throw new Error(
        `No Omni branch named "${requireBranchName(context)}" on model ${modelId}. Create it first with \`orca omni branch --create\`.`
      )
    }
    const json = await this.run(context, commitArgs(modelId, branch.id, message))
    return parseOmniCommit(json, { modelId, branch, message })
  }

  async topics(request: OmniPathRequest): Promise<OmniTopicsResult> {
    const context = await this.resolve(request)
    const modelId = requireModelId(context)
    const branch = await this.currentBranch(context, modelId)
    const json = await this.run(context, listTopicsArgs(modelId, branch?.id ?? null))
    return { modelId, branch, topics: parseOmniTopics(json) }
  }

  async topic(request: OmniTopicRequest): Promise<OmniTopicDetail> {
    const context = await this.resolve(request)
    const modelId = requireModelId(context)
    const branch = await this.currentBranch(context, modelId)
    const json = await this.run(context, getTopicArgs(modelId, request.topic, branch?.id ?? null))
    return parseOmniTopic(json, { modelId, branch })
  }

  private async listBranches(context: OmniContext, modelId: string): Promise<OmniBranch[]> {
    const json = await this.run(context, listModelsArgs({ modelId, withBranches: true }))
    return parseOmniBranches(json, modelId)
  }

  /** Why null on a detached HEAD: validate and topics then read the shared model. */
  private async currentBranch(context: OmniContext, modelId: string): Promise<OmniBranch | null> {
    const name = context.summary.gitBranch
    if (!name) {
      return null
    }
    const branches = await this.listBranches(context, modelId)
    return branches.find((entry) => entry.name === name) ?? null
  }

  private async run(context: OmniContext, args: string[]): Promise<unknown> {
    const binary = context.summary.binary
    if (!binary) {
      throw new OmniCliError(
        'No omni binary found. Install the Omni CLI, or set its path in Settings > Analytics Tools.',
        null,
        `omni ${args.slice(0, 2).join(' ')}`
      )
    }
    return runOmniJson(
      { binary: binary.path, args, cwd: context.cwd, env: context.env },
      this.runDeps
    )
  }
}

function requireModelId(context: OmniContext): string {
  if (!context.summary.modelId) {
    throw new Error(
      `No Omni model chosen. Set ${OMNI_MODEL_ENV} in Domain settings > Environment, export it, or pass --model <id>.`
    )
  }
  return context.summary.modelId
}

function requireBranchName(context: OmniContext): string {
  if (!context.summary.gitBranch) {
    throw new Error(
      'This worktree has no git branch (detached HEAD); Pod names the Omni branch after it.'
    )
  }
  return context.summary.gitBranch
}

let installed: AeOmniService | null = null

export function installAeOmniService(deps: OmniServiceDeps, runDeps?: OmniRunDeps): AeOmniService {
  installed = new AeOmniService(deps, runDeps)
  return installed
}

export function getAeOmniService(): AeOmniService {
  if (!installed) {
    throw new Error('Omni service not installed')
  }
  return installed
}
