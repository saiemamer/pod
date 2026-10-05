import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { AeDomainService } from '../../ae/domain-service'
import type {
  AeSetupApplyRequest,
  AeSetupApplyResult,
  AeSetupDetectRequest,
  AeSetupDetection,
  AeSetupRepoInfo,
  AeSetupRunRequest,
  AeSetupRunResult
} from '../../../shared/ae/setup-types'
import { runProcess } from '../../../shared/child-process/run-process'
import { detectAeSetup, type AeSetupProbeDeps } from '../../ae/setup/ae-setup-detect'
import { applyAeSetup, type AeSetupApplyDeps } from '../../ae/setup/ae-setup-apply'
import { runAeSetup } from '../../ae/setup/ae-setup-run'
import { detectAeRepoRole } from '../../ae/domain-repo-role'
import { findGitRoot, findManagedWorktreeForPath } from '../../ae/worktree-for-path'
import { readLoginShellEnv } from '../../ae/setup/ae-login-shell-env'
import { safeHomedir } from '../../ae/dbt/dbt-runner'
import { prepareLocalWorktreeRootForRepo } from '../../worktree-root-preparation'
import { invalidateAuthorizedRootsCache } from '../registered-worktree-roots-cache'
import { addLocalRepoFromPath } from '../repos/local-repo-registration'
import { notifyReposChanged } from '../repos/repos-changed-notification'

export const AE_SETUP_IPC_CHANNELS = [
  'ae:setup:detect',
  'ae:setup:apply',
  'ae:setup:run',
  'ae:setup:repoInfo'
] as const

/** Pod: first setup from a dbt repo and an optional Omni repo. */
export function registerAeSetupHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  domains: AeDomainService
): void {
  for (const channel of AE_SETUP_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  const applyDeps: AeSetupApplyDeps = {
    store,
    domains,
    home: safeHomedir(),
    addRepo: async (path) => {
      const added = await addLocalRepoFromPath(store, path)
      if ('error' in added) {
        throw new Error(added.error)
      }
      await prepareLocalWorktreeRootForRepo(store, added.repo)
      return added.repo
    }
  }
  const probeDeps = async (): Promise<AeSetupProbeDeps> => ({
    run: runProcess,
    env: await readLoginShellEnv(),
    home: safeHomedir()
  })
  const afterApply = (): void => {
    invalidateAuthorizedRootsCache()
    notifyReposChanged(mainWindow)
  }
  ipcMain.handle(
    'ae:setup:detect',
    async (_event, request: AeSetupDetectRequest): Promise<AeSetupDetection> =>
      detectAeSetup(request, await probeDeps())
  )
  ipcMain.handle(
    'ae:setup:apply',
    async (_event, request: AeSetupApplyRequest): Promise<AeSetupApplyResult> => {
      const result = await applyAeSetup(request, applyDeps)
      afterApply()
      return result
    }
  )
  ipcMain.handle(
    'ae:setup:run',
    async (_event, request: AeSetupRunRequest): Promise<AeSetupRunResult> => {
      const result = await runAeSetup(request, { probe: await probeDeps(), apply: applyDeps })
      if (result.applied) {
        afterApply()
      }
      return result
    }
  )
  ipcMain.handle(
    'ae:setup:repoInfo',
    async (_event, request: { path: string }): Promise<AeSetupRepoInfo | null> => {
      // Why map a worktree to its repo: setup registers the folder, and a worktree is not one.
      const worktree = await findManagedWorktreeForPath(domains.runtimeService, request.path)
      const repo = worktree
        ? store.getRepo(worktree.repoId)
        : store
            .getRepos()
            .find((entry) => entry.path === (findGitRoot(request.path) ?? request.path))
      const repoPath = repo?.path ?? findGitRoot(request.path)
      if (!repoPath || repo?.connectionId) {
        return null
      }
      return {
        repoPath,
        role: detectAeRepoRole(repoPath),
        domainId: repo ? (domains.roleForRepo(repo.id)?.domain.id ?? null) : null
      }
    }
  )
}
