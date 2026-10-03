import { useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  getTuiAgentDefaultArgs,
  resolveTuiAgentLaunchArgs
} from '../../../../shared/tui-agent-launch-defaults'
import {
  hasPodMcpConfigArgs,
  withoutPodMcpConfigArgs,
  withPodMcpConfigArgs
} from '../../../../shared/ae/pod-mcp-config'
import type { SettingsSearchEntry } from './settings-search'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'

/**
 * Pod: hands Claude Code agents the dbt MCP server. On writes `<userData>/pod-mcp.json`
 * and adds `--mcp-config` for it to Claude's default arguments; off removes only that pair.
 */
export function PodMcpSwitchRow({
  entry,
  settings,
  updateSettings,
  /** The pod-dbt-mcp path setting; a change rewrites an enabled config. */
  serverPath
}: {
  entry: SettingsSearchEntry
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
  serverPath: string | undefined
}): React.JSX.Element {
  const [configPath, setConfigPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const claudeArgs = resolveTuiAgentLaunchArgs('claude', settings.agentDefaultArgs)
  const enabled = configPath ? hasPodMcpConfigArgs(claudeArgs, configPath) : false

  useEffect(() => {
    void window.api?.ae?.mcp?.configPath().then(setConfigPath)
  }, [])

  useEffect(() => {
    // Why: the file names the server, so a new path must reach it while the switch is on,
    // and a file deleted from user data comes back the next time Settings opens.
    if (enabled) {
      void window.api.ae.mcp.writeConfig().catch((cause: unknown) => setError(errorText(cause)))
    }
  }, [serverPath, enabled])

  const toggle = async (): Promise<void> => {
    if (!configPath || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (!enabled) {
        // Why first: a missing server must stop the switch before Claude gets a dead flag.
        await window.api.ae.mcp.writeConfig()
      }
      const { claude: _previous, ...others } = settings.agentDefaultArgs ?? {}
      const claude = enabled
        ? withoutPodMcpConfigArgs(claudeArgs, configPath)
        : withPodMcpConfigArgs(claudeArgs, configPath)
      // Why: a user who never set Claude's arguments keeps following the built-in default.
      const followsDefault = enabled && claude === getTuiAgentDefaultArgs('claude')
      await updateSettings({ agentDefaultArgs: followsDefault ? others : { ...others, claude } })
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
    >
      <SettingsSwitchRow
        label={entry.title}
        description={
          <>
            {entry.description}
            {error && <span className="mt-1 block text-destructive">{error}</span>}
          </>
        }
        checked={enabled}
        disabled={!configPath || busy}
        onChange={() => void toggle()}
      />
    </SearchableSetting>
  )
}

function errorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
