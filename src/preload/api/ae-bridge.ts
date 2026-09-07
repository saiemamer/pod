import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

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
    lineage: (args) => ipcRenderer.invoke('ae:dbt:lineage', args)
  },
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('ae:changed', listener)
    return () => ipcRenderer.removeListener('ae:changed', listener)
  }
} satisfies PreloadApi['ae']
