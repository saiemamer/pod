import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AeDomainConfig, AeInitiative } from '../../../shared/ae/domain-types'
import {
  installAeDomainService,
  type AeDomainSaveInput,
  type AeInitiativeSaveInput
} from '../../ae/domain-service'

export const AE_DOMAIN_IPC_CHANNELS = [
  'ae:domains:list',
  'ae:domains:save',
  'ae:domains:remove',
  'ae:domains:detectRoles',
  'ae:domains:setSecret',
  'ae:domains:removeSecret',
  'ae:initiatives:list',
  'ae:initiatives:save',
  'ae:initiatives:remove'
] as const

/** Pod: domain and initiative IPC. Also installs the domain service, since this is where store and runtime meet. */
export function registerAeDomainHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService
): void {
  const service = installAeDomainService(store, runtime)
  for (const channel of AE_DOMAIN_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  const changed = (): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ae:changed')
    }
  }

  ipcMain.handle('ae:domains:list', (): AeDomainConfig[] => service.listDomains())
  ipcMain.handle('ae:domains:save', (_event, input: AeDomainSaveInput): AeDomainConfig => {
    const saved = service.saveDomain(input)
    changed()
    return saved
  })
  ipcMain.handle('ae:domains:remove', (_event, args: { domainId: string }): void => {
    service.removeDomain(args.domainId)
    changed()
  })
  ipcMain.handle('ae:domains:detectRoles', (_event, args: { groupId: string }) =>
    service.detectRoles(args.groupId)
  )
  ipcMain.handle(
    'ae:domains:setSecret',
    (_event, args: { domainId: string; name: string; value: string }): void => {
      service.setSecret(args.domainId, args.name, args.value)
      changed()
    }
  )
  ipcMain.handle(
    'ae:domains:removeSecret',
    (_event, args: { domainId: string; name: string }): void => {
      service.removeSecret(args.domainId, args.name)
      changed()
    }
  )
  ipcMain.handle('ae:initiatives:list', (_event, args?: { domainId?: string }): AeInitiative[] =>
    service.listInitiatives(args?.domainId)
  )
  ipcMain.handle('ae:initiatives:save', (_event, input: AeInitiativeSaveInput): AeInitiative => {
    const saved = service.saveInitiative(input)
    changed()
    return saved
  })
  ipcMain.handle('ae:initiatives:remove', (_event, args: { initiativeId: string }): void => {
    service.removeInitiative(args.initiativeId)
    changed()
  })
}
