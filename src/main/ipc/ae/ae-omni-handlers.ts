import { ipcMain } from 'electron'
import type { AeOmniService } from '../../ae/omni/omni-service'
import type {
  OmniBranchRequest,
  OmniPathRequest,
  OmniTopicRequest
} from '../../../shared/ae/omni-types'

export const AE_OMNI_IPC_CHANNELS = [
  'ae:omni:context',
  'ae:omni:models',
  'ae:omni:branch',
  'ae:omni:validate',
  'ae:omni:topics',
  'ae:omni:topic'
] as const

/** Pod: the Omni panel's IPC, reads plus branch creation. Committing is `orca omni commit` only. */
export function registerAeOmniHandlers(service: AeOmniService): void {
  for (const channel of AE_OMNI_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle('ae:omni:context', (_event, args: OmniPathRequest) => service.context(args))
  ipcMain.handle('ae:omni:models', (_event, args: OmniPathRequest) => service.models(args))
  ipcMain.handle('ae:omni:branch', (_event, args: OmniBranchRequest) => service.branch(args))
  ipcMain.handle('ae:omni:validate', (_event, args: OmniPathRequest) => service.validate(args))
  ipcMain.handle('ae:omni:topics', (_event, args: OmniPathRequest) => service.topics(args))
  ipcMain.handle('ae:omni:topic', (_event, args: OmniTopicRequest) => service.topic(args))
}
