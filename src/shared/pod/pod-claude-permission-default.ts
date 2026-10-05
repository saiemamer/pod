import { POD_CLAUDE_FOLLOWS_OWN_PERMISSIONS } from '../brand'
import { POD_MCP_CONFIG_FILE } from '../ae/pod-mcp-config'
import type { GlobalSettings } from '../global-settings-types'
import type { TuiAgent } from '../tui-agent'
import {
  applyAgentPermissionMode,
  resolveAgentPermissionModeSummary
} from '../tui-agent-permissions'

/** Orca's built-in launch arguments, minus Claude's bypass flag in Pod; other agents keep theirs. */
export function podDefaultTuiAgentArgs(
  orcaDefaults: Partial<Record<TuiAgent, string>>
): Partial<Record<TuiAgent, string>> {
  if (!POD_CLAUDE_FOLLOWS_OWN_PERMISSIONS) {
    return orcaDefaults
  }
  const { claude: _bypass, ...others } = orcaDefaults
  return others
}

type AgentArgsMigration = Pick<GlobalSettings, 'agentDefaultArgs'>

/**
 * Pod 0.1.13 and earlier saved Orca's Claude bypass flag into every profile at first start, so
 * those installs would keep bypassing. Once per profile, drop the flag where it is exactly that
 * saved default, alone or followed only by Pod's own `--mcp-config` pair from the dbt MCP switch.
 * Anything else is a person's own setting and stays as typed.
 */
export function podClearSavedClaudeBypassDefault<T extends AgentArgsMigration>(
  migrated: T,
  loaded: Partial<GlobalSettings> | undefined,
  markNeedsSave: () => void
): T & Pick<GlobalSettings, 'podClaudeBypassDefaultCleared'> {
  if (!POD_CLAUDE_FOLLOWS_OWN_PERMISSIONS || loaded?.podClaudeBypassDefaultCleared === true) {
    return migrated
  }
  markNeedsSave()
  const { claude, ...others } = migrated.agentDefaultArgs ?? {}
  const match = claude?.trim().match(/^--dangerously-skip-permissions(?:\s+(.*))?$/)
  const rest = match?.[1]
  const agentDefaultArgs = !match
    ? migrated.agentDefaultArgs
    : !rest
      ? others
      : isPodMcpConfigPair(rest)
        ? { ...others, claude: rest }
        : migrated.agentDefaultArgs
  return { ...migrated, agentDefaultArgs, podClaudeBypassDefaultCleared: true }
}

function isPodMcpConfigPair(args: string): boolean {
  const file = POD_MCP_CONFIG_FILE.replace('.', '\\.')
  return new RegExp(`^--mcp-config ('[^']*/${file}'|\\S*/${file})$`).test(args)
}

/**
 * Onboarding's agent step opens with "run without asking" on whenever any agent defaults to
 * bypass, and Orca writes that mode for every agent on Continue, Claude included. In Pod a
 * toggle left as it opened writes nothing; one the person changed applies as in Orca.
 */
export function podOnboardingAgentPermissionUpdate(args: {
  yoloPermissions: boolean
  agentDefaultArgs?: Partial<Record<TuiAgent, string>> | null
  agentDefaultEnv?: Partial<Record<TuiAgent, Record<string, string>>> | null
}): Partial<Pick<GlobalSettings, 'agentDefaultArgs' | 'agentDefaultEnv'>> {
  const opened = resolveAgentPermissionModeSummary(args) !== 'manual'
  if (POD_CLAUDE_FOLLOWS_OWN_PERMISSIONS && args.yoloPermissions === opened) {
    return {}
  }
  return applyAgentPermissionMode({ ...args, mode: args.yoloPermissions ? 'yolo' : 'manual' })
}

const CLAUDE_BYPASS_FLAG = '--dangerously-skip-permissions'
// A person who typed any of these chose Claude's permission behaviour; their arguments stand.
const CLAUDE_PERMISSION_CHOICE =
  /(^|\s)(--dangerously-skip-permissions|--allow-dangerously-skip-permissions|--permission-mode|--safe-mode)(?=\s|=|$)/

/**
 * A Claude worker dispatched for an orchestration task runs in a terminal nobody watches, so it
 * starts with Orca's bypass flag in front of the person's own arguments. Claude Code still shows
 * its one-time Bypass Permissions confirmation; Pod tells the person to accept it there. Every
 * other session, and any launch whose caller passed its own arguments, is left as resolved.
 */
export function podClaudeWorkerArgs(args: {
  agent: TuiAgent
  launchSource?: string
  callerArgs?: string | null
  resolvedArgs: string | null
}): string | null {
  if (
    !POD_CLAUDE_FOLLOWS_OWN_PERMISSIONS ||
    args.agent !== 'claude' ||
    args.launchSource !== 'orchestration' ||
    args.callerArgs !== undefined
  ) {
    return args.resolvedArgs
  }
  const typed = args.resolvedArgs?.trim() ?? ''
  if (CLAUDE_PERMISSION_CHOICE.test(typed)) {
    return args.resolvedArgs
  }
  return typed ? `${CLAUDE_BYPASS_FLAG} ${typed}` : CLAUDE_BYPASS_FLAG
}
