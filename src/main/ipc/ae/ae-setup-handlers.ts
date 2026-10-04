import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { AeDomainService } from '../../ae/domain-service'
import type {
  AeSetupApplyRequest,
  AeSetupApplyResult,
  AeSetupDetectRequest,
  AeSetupDetection
} from '../../../shared/ae/setup-types'
import { runProcess } from '../../../shared/child-process/run-process'
import { detectAeSetup } from '../../ae/setup/ae-setup-detect'
import { applyAeSetup } from '../../ae/setup/ae-setup-apply'
import { readLoginShellEnv } from '../../ae/setup/ae-login-shell-env'
import { safeHomedir } from '../../ae/dbt/dbt-runner'
import { prepareLocalWorktreeRootForRepo } from '../../worktree-root-preparation'
import { invalidateAuthorizedRootsCache } from '../registered-worktree-roots-cache'
import { addLocalRepoFromPath } from '../repos/local-repo-registration'
import { notifyReposChanged } from '../repos/repos-changed-notification'

export const AE_SETUP_IPC_CHANNELS = ['ae:setup:detect', 'ae:setup:apply'] as const

/** Pod: first setup from a dbt repo and an optional Omni repo. */
export function registerAeSetupHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  domains: AeDomainService
): void {
  for (const channel of AE_SETUP_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle(
    'ae:setup:detect',
    async (_event, request: AeSetupDetectRequest): Promise<AeSetupDetection> =>
      detectAeSetup(request, {
        run: runProcess,
        env: await readLoginShellEnv(),
        home: safeHomedir()
      })
  )
  ipcMain.handle(
    'ae:setup:apply',
    async (_event, request: AeSetupApplyRequest): Promise<AeSetupApplyResult> => {
      const result = await applyAeSetup(request, {
        store,
        domains,
        addRepo: async (path) => {
          const added = await addLocalRepoFromPath(store, path)
          if ('error' in added) {
            throw new Error(added.error)
          }
          await prepareLocalWorktreeRootForRepo(store, added.repo)
          return added.repo
        }
      })
      invalidateAuthorizedRootsCache()
      notifyReposChanged(mainWindow)
      return result
    }
  )
}
