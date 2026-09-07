import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PreloadApi } from '../api-types'
import type { DbtLspEvent } from '../../shared/ae/dbt-lsp-types'

export const aeApi = {
  domains: {
    list: () => ipcRenderer.invoke('ae:domains:list'),
    save: (input) => ipcRenderer.invoke('ae:domains:save', input),
    remove: (args) => ipcRenderer.invoke('ae:domains:remove', args),
    detectRoles: (args) => ipcRenderer.invoke('ae:domains:detectRoles', args),
    setSecret: (args) => ipcRenderer.invoke('ae:domains:setSecret', args),
    removeSecret: (args) => ipcRenderer.invoke('ae:domains:removeSecret', args),
    openMainAgent: (args) => ipcRenderer.invoke('ae:domains:openMainAgent', args)
  },
  initiatives: {
    list: (args) => ipcRenderer.invoke('ae:initiatives:list', args),
    save: (input) => ipcRenderer.invoke('ae:initiatives:save', input),
    remove: (args) => ipcRenderer.invoke('ae:initiatives:remove', args),
    launch: (args) => ipcRenderer.invoke('ae:initiatives:launch', args)
  },
  dbt: {
    project: (args) => ipcRenderer.invoke('ae:dbt:project', args),
    show: (args) => ipcRenderer.invoke('ae:dbt:show', args),
    compile: (args) => ipcRenderer.invoke('ae:dbt:compile', args),
    parse: (args) => ipcRenderer.invoke('ae:dbt:parse', args),
    listModels: (args) => ipcRenderer.invoke('ae:dbt:listModels', args),
    modelInfo: (args) => ipcRenderer.invoke('ae:dbt:modelInfo', args),
    lineage: (args) => ipcRenderer.invoke('ae:dbt:lineage', args),
    ensureCatalog: (args) => ipcRenderer.invoke('ae:dbt:ensureCatalog', args),
    resolveRef: (args) => ipcRenderer.invoke('ae:dbt:resolveRef', args),
    exportCsv: (args) => ipcRenderer.invoke('ae:dbt:exportCsv', args),
    graph: (args) => ipcRenderer.invoke('ae:dbt:graph', args),
    columnLineage: (args) => ipcRenderer.invoke('ae:dbt:columnLineage', args),
    catalogTree: (args) => ipcRenderer.invoke('ae:dbt:catalogTree', args),
    lineageEngine: (args) => ipcRenderer.invoke('ae:dbt:lineageEngine', args),
    lsp: {
      status: (args) => ipcRenderer.invoke('ae:dbt:lsp:status', args),
      open: (args) => ipcRenderer.invoke('ae:dbt:lsp:open', args),
      change: (args) => ipcRenderer.invoke('ae:dbt:lsp:change', args),
      close: (args) => ipcRenderer.invoke('ae:dbt:lsp:close', args),
      completion: (args) => ipcRenderer.invoke('ae:dbt:lsp:completion', args),
      hover: (args) => ipcRenderer.invoke('ae:dbt:lsp:hover', args),
      definition: (args) => ipcRenderer.invoke('ae:dbt:lsp:definition', args),
      restart: (args) => ipcRenderer.invoke('ae:dbt:lsp:restart', args),
      onEvent: (callback: (event: DbtLspEvent) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, payload: DbtLspEvent): void => callback(payload)
        ipcRenderer.on('ae:dbt:lsp:event', listener)
        return () => ipcRenderer.removeListener('ae:dbt:lsp:event', listener)
      }
    }
  },
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('ae:changed', listener)
    return () => ipcRenderer.removeListener('ae:changed', listener)
  }
} satisfies PreloadApi['ae']
