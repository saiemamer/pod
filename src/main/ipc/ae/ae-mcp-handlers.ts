import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import { getAppEnvironment } from '../../../shared/app-environment'
import { getBundledLauncherPath } from '../../cli/bundled-cli-launcher-path'
import { normalizeAeToolCmdOverrides } from '../../../shared/ae/dbt-settings-types'
import { POD_MCP_CONFIG_FILE } from '../../../shared/ae/pod-mcp-config'
import { writePodMcpConfig } from '../../ae/pod-mcp-config-writer'

export const AE_MCP_IPC_CHANNELS = ['ae:mcp:configPath', 'ae:mcp:writeConfig'] as const

/** Pod: the Analytics Tools switch that hands Claude Code agents the dbt MCP server. */
export function registerAeMcpHandlers(store: Store): void {
  for (const channel of AE_MCP_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  const userData = (): string => getAppEnvironment().getPath('userData')
  ipcMain.handle('ae:mcp:configPath', () => join(userData(), POD_MCP_CONFIG_FILE))
  ipcMain.handle('ae:mcp:writeConfig', () => {
    // Why only when packaged: a dev build has no bundled launcher, and its terminals put orca on PATH.
    const launcher = getAppEnvironment().isPackaged()
      ? getBundledLauncherPath(process.platform, process.resourcesPath)
      : null
    return writePodMcpConfig({
      userDataPath: userData(),
      override: normalizeAeToolCmdOverrides(store.getSettings().toolCmdOverrides).dbtMcp,
      env: process.env,
      orcaBin: launcher && existsSync(launcher) ? launcher : null
    })
  })
}
