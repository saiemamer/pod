import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const aeApi = {
  domains: {
    list: () => ipcRenderer.invoke('ae:domains:list'),
    save: (input) => ipcRenderer.invoke('ae:domains:save', input),
    remove: (args) => ipcRenderer.invoke('ae:domains:remove', args),
    detectRoles: (args) => ipcRenderer.invoke('ae:domains:detectRoles', args),
    setSecret: (args) => ipcRenderer.invoke('ae:domains:setSecret', args),
    removeSecret: (args) => ipcRenderer.invoke('ae:domains:removeSecret', args)
  },
  initiatives: {
    list: (args) => ipcRenderer.invoke('ae:initiatives:list', args),
    save: (input) => ipcRenderer.invoke('ae:initiatives:save', input),
    remove: (args) => ipcRenderer.invoke('ae:initiatives:remove', args)
  },
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('ae:changed', listener)
    return () => ipcRenderer.removeListener('ae:changed', listener)
  }
} satisfies PreloadApi['ae']
