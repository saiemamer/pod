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
import { launchAeDomainAgent, launchAeInitiative } from '../../ae/initiative-launch'
import { installAeDbtService } from '../../ae/dbt/dbt-service'
import { DbtLspService } from '../../ae/dbt/dbt-lsp-service'
import { AE_DBT_LSP_EVENT_CHANNEL, registerAeDbtHandlers } from './ae-dbt-handlers'
import { getAppEnvironment } from '../../../shared/app-environment'
import { getMainHttpClient } from '../../network/http-client'
import type { TuiAgent } from '../../../shared/tui-agent'

export const AE_DOMAIN_IPC_CHANNELS = [
  'ae:domains:list',
  'ae:domains:save',
  'ae:domains:remove',
  'ae:domains:detectRoles',
  'ae:domains:setSecret',
  'ae:domains:removeSecret',
  'ae:initiatives:list',
  'ae:initiatives:save',
  'ae:initiatives:remove',
  'ae:initiatives:launch',
  'ae:domains:openMainAgent'
] as const

/** Pod: domain and initiative IPC. Also installs the domain service, since this is where store and runtime meet. */
export function registerAeDomainHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService
): void {
  const service = installAeDomainService(store, runtime)
  const dbt = installAeDbtService({ store, runtime, domains: service })
  const lsp = new DbtLspService({
    dbt,
    userData: () => getAppEnvironment().getPath('userData'),
    fetch: (url) => getMainHttpClient().fetch(url),
    emit: (event) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(AE_DBT_LSP_EVENT_CHANNEL, event)
      }
    }
  })
  // Why: a language server left behind keeps a dbt project's files open after Pod quits.
  getAppEnvironment().onWillQuit(() => void lsp.stopAll())
  registerAeDbtHandlers(dbt, lsp, mainWindow)
  for (const channel of AE_DOMAIN_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  // Why: the service emits for IPC, CLI RPC and launcher mutations alike, so the renderer refreshes when the main agent records a run.
  service.onChanged(() => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ae:changed')
    }
  })

  ipcMain.handle('ae:domains:list', (): AeDomainConfig[] => service.listDomains())
  ipcMain.handle('ae:domains:save', (_event, input: AeDomainSaveInput): AeDomainConfig => {
    return service.saveDomain(input)
  })
  ipcMain.handle('ae:domains:remove', (_event, args: { domainId: string }): void => {
    service.removeDomain(args.domainId)
  })
  ipcMain.handle('ae:domains:detectRoles', (_event, args: { groupId: string }) =>
    service.detectRoles(args.groupId)
  )
  ipcMain.handle(
    'ae:domains:setSecret',
    (_event, args: { domainId: string; name: string; value: string }): void => {
      service.setSecret(args.domainId, args.name, args.value)
    }
  )
  ipcMain.handle(
    'ae:domains:removeSecret',
    (_event, args: { domainId: string; name: string }): void => {
      service.removeSecret(args.domainId, args.name)
    }
  )
  ipcMain.handle('ae:initiatives:list', (_event, args?: { domainId?: string }): AeInitiative[] =>
    service.listInitiatives(args?.domainId)
  )
  ipcMain.handle('ae:initiatives:save', (_event, input: AeInitiativeSaveInput): AeInitiative => {
    return service.saveInitiative(input)
  })
  ipcMain.handle('ae:initiatives:remove', (_event, args: { initiativeId: string }): void => {
    service.removeInitiative(args.initiativeId)
  })
  ipcMain.handle(
    'ae:initiatives:launch',
    async (
      _event,
      args: {
        domainId: string
        title: string
        stakeholderTeam?: string
        agent?: TuiAgent
        repoIds?: string[]
      }
    ): Promise<AeInitiative> => {
      return launchAeInitiative(service, args)
    }
  )
  ipcMain.handle(
    'ae:domains:openMainAgent',
    async (_event, args: { domainId: string; agent?: TuiAgent }) => {
      return launchAeDomainAgent(service, args)
    }
  )
}
