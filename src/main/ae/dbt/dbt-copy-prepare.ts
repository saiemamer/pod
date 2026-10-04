import { existsSync, readdirSync, rmdirSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DbtPrepareFailure,
  DbtPrepareState,
  DbtPrepareStep
} from '../../../shared/ae/dbt-readiness-types'
import type { DbtPathRequest } from '../../../shared/ae/dbt-types'
import type { RuntimeWorktreeLifecycleEvent } from '../../runtime/orca-runtime'
import { ApfsCloneUnavailableError, cloneWorktreePathWithApfs } from '../../ipc/worktree-apfs-clone'
import type { DbtContext } from './dbt-context'
import {
  checkDbtReadiness,
  dbtGitPackageTokenVariables,
  dbtPackagesInstallDir,
  primaryProjectDir,
  samePackageFiles
} from './dbt-copy-readiness'
import { readDbtProject } from './dbt-project-discovery'
import { DbtRunError, type AeDbtService } from './dbt-service'

/**
 * Pod: makes a copy of a dbt project usable without anyone typing dbt commands.
 * Packages come from the main checkout when both list the same ones (no network, no
 * token), else from `dbt deps`; then `dbt parse` writes the manifest and the language
 * server restarts so hover and Cmd-click see both. One run per project at a time.
 */
export type DbtCopyPreparerDeps = {
  dbt: Pick<AeDbtService, 'resolve' | 'run'>
  restartLsp: (projectDir: string) => Promise<unknown>
  emit: (state: DbtPrepareState) => void
  platform?: NodeJS.Platform
}

const ACCESS_REFUSED =
  /access denied|authentication failed|could not read username|permission denied \(publickey\)|repository not found|\b40[13]\b/i

export class DbtCopyPreparer {
  private readonly states = new Map<string, DbtPrepareState>()
  private readonly running = new Map<string, Promise<DbtPrepareState>>()

  constructor(private readonly deps: DbtCopyPreparerDeps) {}

  async readiness(request: DbtPathRequest): Promise<DbtPrepareState> {
    const context = await this.deps.dbt.resolve(request)
    const readiness = checkDbtReadiness(context.project)
    const known = this.states.get(context.project.projectDir)
    if (known && (known.state === 'running' || (known.state === 'failed' && !readiness.ready))) {
      return { ...known, readiness }
    }
    return {
      projectDir: context.project.projectDir,
      state: readiness.ready ? 'done' : 'idle',
      readiness
    }
  }

  async prepare(request: DbtPathRequest): Promise<DbtPrepareState> {
    return this.start(await this.deps.dbt.resolve(request))
  }

  /** A new worktree: prepare it in the background when it holds a dbt project that is not ready. */
  async prepareNewCopy(worktreePath: string): Promise<DbtPrepareState | null> {
    let context: DbtContext
    try {
      context = await this.deps.dbt.resolve({ path: worktreePath })
    } catch {
      return null
    }
    if (!context.primaryRoot || checkDbtReadiness(context.project).ready) {
      return null
    }
    return this.start(context)
  }

  private start(context: DbtContext): Promise<DbtPrepareState> {
    const dir = context.project.projectDir
    const inFlight = this.running.get(dir)
    if (inFlight) {
      return inFlight
    }
    const run = this.run(context).finally(() => this.running.delete(dir))
    this.running.set(dir, run)
    return run
  }

  private async run(context: DbtContext): Promise<DbtPrepareState> {
    const project = context.project
    const publish = (state: DbtPrepareState['state'], step?: DbtPrepareStep): DbtPrepareState => {
      const next: DbtPrepareState = {
        projectDir: project.projectDir,
        state,
        ...(step ? { step } : {}),
        readiness: checkDbtReadiness(project)
      }
      this.states.set(project.projectDir, next)
      this.deps.emit(next)
      return next
    }
    const fail = (failure: DbtPrepareFailure): DbtPrepareState => {
      const next: DbtPrepareState = {
        projectDir: project.projectDir,
        state: 'failed',
        readiness: checkDbtReadiness(project),
        failure
      }
      this.states.set(project.projectDir, next)
      this.deps.emit(next)
      console.warn(`[pod-dbt] preparing ${project.projectDir} failed: ${failure.kind}`)
      return next
    }

    const before = publish('running')
    let installedNow = false
    if (!before.readiness.packagesInstalled) {
      const source = reusablePackagesDir(context)
      if (source) {
        publish('running', 'packages-reuse')
        installedNow = await copyPackages(
          source,
          dbtPackagesInstallDir(project),
          this.deps.platform
        )
      }
      if (!installedNow) {
        publish('running', 'packages-deps')
        try {
          await this.deps.dbt.run(context, ['deps'])
        } catch (error) {
          return fail(describeFailure(error, context, 'packages'))
        }
        installedNow = true
      }
    }
    if (installedNow || !before.readiness.manifest) {
      publish('running', 'parse')
      try {
        await this.deps.dbt.run(context, ['parse'])
      } catch (error) {
        return fail(describeFailure(error, context, 'parse'))
      }
    }
    // Why: the server read the project before packages and manifest existed.
    await this.deps.restartLsp(project.projectDir).catch(() => undefined)
    return publish('done')
  }
}

/** The main checkout's installed packages, when they are the very packages this copy lists. */
function reusablePackagesDir(context: DbtContext): string | null {
  const primaryDir = primaryProjectDir(
    context.project.projectDir,
    context.repoRoot,
    context.primaryRoot
  )
  if (!primaryDir || !samePackageFiles(primaryDir, context.project.projectDir)) {
    return null
  }
  const primary = readDbtProject(join(primaryDir, 'dbt_project.yml'))
  return checkDbtReadiness(primary).packagesInstalled ? dbtPackagesInstallDir(primary) : null
}

/** Copy-on-write clone on APFS, a plain copy elsewhere; false sends the caller to `dbt deps`. */
async function copyPackages(
  source: string,
  target: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  try {
    if (existsSync(target)) {
      if (readdirSync(target).length > 0) {
        return false
      }
      rmdirSync(target)
    }
    if (platform === 'darwin') {
      try {
        await cloneWorktreePathWithApfs(source, target, true)
        return true
      } catch (error) {
        if (!(error instanceof ApfsCloneUnavailableError)) {
          throw error
        }
      }
    }
    await cp(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true
    })
    return true
  } catch {
    return false
  }
}

function describeFailure(
  error: unknown,
  context: DbtContext,
  stage: 'packages' | 'parse'
): DbtPrepareFailure {
  const raw = error instanceof Error ? error.message : String(error)
  const details = maskSecrets(raw, context.secretValues)
  if (error instanceof DbtRunError && !error.result) {
    return { kind: 'no-dbt', details }
  }
  if (stage === 'packages' && ACCESS_REFUSED.test(raw)) {
    const [tokenVariable] = dbtGitPackageTokenVariables(context.project.projectDir)
    return { kind: 'private-package', ...(tokenVariable ? { tokenVariable } : {}), details }
  }
  return { kind: stage, details }
}

/** dbt can echo a git URL with its token filled in; never let a value reach the screen. */
function maskSecrets(text: string, values: readonly string[]): string {
  let masked = text.replace(/(:\/\/)[^/\s@]+@/g, '$1***@')
  // Why 6: masking short values such as `dev` or `true` would blank ordinary words.
  const secrets = [...new Set(values)]
    .filter((value) => value.length >= 6)
    .sort((a, b) => b.length - a.length)
  for (const value of secrets) {
    masked = masked.split(value).join('***')
  }
  return masked
}

let installed: DbtCopyPreparer | null = null

export function installDbtCopyPreparer(deps: DbtCopyPreparerDeps): DbtCopyPreparer {
  installed = new DbtCopyPreparer(deps)
  return installed
}

/** Called for every worktree Pod creates; never blocks or fails the creation. */
export function notifyPodWorktreeLifecycle(event: RuntimeWorktreeLifecycleEvent): void {
  if (event.kind === 'created' && installed) {
    void installed.prepareNewCopy(event.path).catch(() => undefined)
  }
}
