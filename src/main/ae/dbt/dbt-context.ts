import { resolve } from 'node:path'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AeDomainService } from '../domain-service'
import { findGitRoot, findManagedWorktreeForPath } from '../worktree-for-path'
import {
  normalizeAeDbtSettings,
  normalizeAeToolCmdOverrides,
  type AeDbtSettings,
  type AeToolCmdOverrides
} from '../../../shared/ae/dbt-settings-types'
import type {
  DbtContextSummary,
  DbtManifestSummary,
  DbtPathRequest
} from '../../../shared/ae/dbt-types'
import { discoverDbtProject, type DbtProjectInfo } from './dbt-project-discovery'
import { findDbtProfilesDir, type DbtProfilesLocation } from './dbt-profiles-search'
import { loadDbtEnvFiles } from './dbt-env-file'
import { findPrimaryCheckout } from './dbt-copy-readiness'
import { resolveDbtBinary, type DbtBinary } from './dbt-runner'
import { dbtManifestPath, loadDbtManifest } from './dbt-manifest'
import { summarizeDbtCatalog } from './dbt-catalog-refresh'

/**
 * Pod: everything a dbt command needs, resolved from one path. Settings, the domain
 * that owns the repo, its secrets and the project's env files are merged here once, so
 * the editor, the CLI and agents all run dbt the same way.
 */
export type DbtContext = {
  project: DbtProjectInfo
  repoRoot: string | null
  /** Main checkout when repoRoot is a linked worktree of it. */
  primaryRoot: string | null
  worktree: { id: string; repoId: string; path: string } | null
  domainId: string | null
  binary: DbtBinary | null
  target?: string
  profiles: DbtProfilesLocation
  envFiles: string[]
  /** The child environment. Stays in the main process. */
  env: NodeJS.ProcessEnv
  /** Values from env files and secrets, to mask in any dbt text shown to a person. */
  secretValues: string[]
  settings: AeDbtSettings
  toolOverrides: AeToolCmdOverrides
}

export type DbtContextDeps = {
  store: Store
  runtime: OrcaRuntimeService
  domains: AeDomainService | null
  env?: NodeJS.ProcessEnv
}

export class DbtProjectNotFoundError extends Error {
  constructor(path: string) {
    super(
      `No dbt_project.yml found at or above ${path}. Open a file inside a dbt project, or set the project directory in Settings > dbt.`
    )
    this.name = 'DbtProjectNotFoundError'
  }
}

export async function resolveDbtContext(
  deps: DbtContextDeps,
  request: DbtPathRequest & { target?: string }
): Promise<DbtContext> {
  const path = resolve(request.path)
  const found = await findManagedWorktreeForPath(deps.runtime, path)
  const worktree = found ? { id: found.id, repoId: found.repoId, path: found.path } : null
  const repoRoot = worktree?.path ?? findGitRoot(path)
  const globalSettings = deps.store.getSettings()
  const settings = normalizeAeDbtSettings(globalSettings.aeDbt)
  const overrides = normalizeAeToolCmdOverrides(globalSettings.toolCmdOverrides)
  const domain = worktree && deps.domains ? deps.domains.roleForRepo(worktree.repoId)?.domain : null
  const project = discoverDbtProject({
    startPath: path,
    stopAt: repoRoot ?? undefined,
    projectDir: request.projectDir ?? domain?.dbt?.projectDir ?? settings.projectDir
  })
  if (!project) {
    throw new DbtProjectNotFoundError(path)
  }
  const primaryRoot = repoRoot ? findPrimaryCheckout(repoRoot) : null
  const files = loadDbtEnvFiles({
    projectDir: project.projectDir,
    repoRoot,
    primaryRoot,
    envFile: settings.envFile
  })
  const secrets = domain && deps.domains ? deps.domains.readSecrets(domain.id) : {}
  const domainEnv = domain ? { ...domain.env, ...secrets } : {}
  // Why this order: env files are the project's defaults, the real environment beats
  // them, and what someone typed into Pod (domain env, secrets, dbt settings) beats both.
  const env: NodeJS.ProcessEnv = {
    ...files.values,
    ...(deps.env ?? process.env),
    ...domainEnv,
    ...settings.env
  }
  const target = request.target ?? domain?.dbt?.target ?? settings.target ?? env.DBT_TARGET
  return {
    project,
    repoRoot,
    primaryRoot,
    worktree,
    domainId: domain?.id ?? null,
    binary: resolveDbtBinary(overrides.dbt, env),
    ...(target ? { target } : {}),
    profiles: findDbtProfilesDir({
      projectDir: project.projectDir,
      repoRoot,
      override: domain?.dbt?.profilesDir ?? settings.profilesDir,
      env
    }),
    envFiles: files.files,
    env,
    secretValues: [...Object.values(files.values), ...Object.values(secrets)],
    settings,
    toolOverrides: overrides
  }
}

export function summarizeDbtManifest(project: DbtProjectInfo): DbtManifestSummary {
  const file = dbtManifestPath(project)
  const manifest = loadDbtManifest(file)
  return manifest
    ? {
        file,
        exists: true,
        generatedAt: manifest.generatedAt,
        dbtVersion: manifest.dbtVersion,
        nodeCount: manifest.nodes.size
      }
    : { file, exists: false }
}

/** What leaves the main process: no env values, plus what the manifest on disk says. */
export function summarizeDbtContext(context: DbtContext): DbtContextSummary {
  return {
    project: { ...context.project },
    repoRoot: context.repoRoot,
    worktree: context.worktree,
    domainId: context.domainId,
    binary: context.binary,
    ...(context.target ? { target: context.target } : {}),
    profiles: { ...context.profiles },
    envFiles: context.envFiles,
    distribution: context.settings.distribution,
    showLimit: context.settings.showLimit,
    parseOnLoad: context.settings.parseOnLoad,
    lspEnabled: context.settings.lspEnabled,
    catalog: summarizeDbtCatalog(context.project),
    manifest: summarizeDbtManifest(context.project)
  }
}
