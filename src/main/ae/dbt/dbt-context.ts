import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AeDomainService } from '../domain-service'
import {
  normalizeAeDbtSettings,
  normalizeAeToolCmdOverrides,
  type AeDbtSettings
} from '../../../shared/ae/dbt-settings-types'
import type { DbtContextSummary, DbtPathRequest } from '../../../shared/ae/dbt-types'
import { discoverDbtProject, type DbtProjectInfo } from './dbt-project-discovery'
import { findDbtProfilesDir, type DbtProfilesLocation } from './dbt-profiles-search'
import { loadDbtEnvFiles } from './dbt-env-file'
import { resolveDbtBinary, type DbtBinary } from './dbt-runner'
import { dbtManifestPath, loadDbtManifest } from './dbt-manifest'

/**
 * Pod: everything a dbt command needs, resolved from one path. Settings, the domain
 * that owns the repo, its secrets and the project's env files are merged here once, so
 * the editor, the CLI and agents all run dbt the same way.
 */
export type DbtContext = {
  project: DbtProjectInfo
  repoRoot: string | null
  worktree: { id: string; repoId: string; path: string } | null
  domainId: string | null
  binary: DbtBinary | null
  target?: string
  profiles: DbtProfilesLocation
  envFiles: string[]
  /** The child environment. Stays in the main process. */
  env: NodeJS.ProcessEnv
  settings: AeDbtSettings
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
  const worktree = await findWorktreeForPath(deps.runtime, path)
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
  const files = loadDbtEnvFiles({
    projectDir: project.projectDir,
    repoRoot,
    envFile: settings.envFile
  })
  const domainEnv =
    domain && deps.domains ? { ...domain.env, ...deps.domains.readSecrets(domain.id) } : {}
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
    settings
  }
}

/** What leaves the main process: no env values, plus what the manifest on disk says. */
export function summarizeDbtContext(context: DbtContext): DbtContextSummary {
  const file = dbtManifestPath(context.project)
  const manifest = loadDbtManifest(file)
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
    manifest: manifest
      ? {
          file,
          exists: true,
          generatedAt: manifest.generatedAt,
          dbtVersion: manifest.dbtVersion,
          nodeCount: manifest.nodes.size
        }
      : { file, exists: false }
  }
}

/** Walk up from the path asking Orca for a managed worktree at each directory. */
async function findWorktreeForPath(
  runtime: OrcaRuntimeService,
  path: string
): Promise<DbtContext['worktree']> {
  let dir = isDirectory(path) ? path : dirname(path)
  for (let depth = 0; depth < 16; depth += 1) {
    try {
      const worktree = await runtime.showManagedWorktree(`path:${dir}`)
      return { id: worktree.id, repoId: worktree.repoId, path: worktree.path }
    } catch {
      // Why: selector_not_found is the normal answer for a subdirectory; keep climbing.
    }
    const parent = dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

export function findGitRoot(path: string): string | null {
  let dir = isDirectory(path) ? path : dirname(path)
  for (let depth = 0; depth < 32; depth += 1) {
    if (existsSync(join(dir, '.git'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return null
    }
    dir = parent
  }
  return null
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
