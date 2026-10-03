import { quoteStartupArg } from '../tui-agent-startup-shell'

/**
 * Pod: the dbt MCP server reaches Claude Code agents through one `--mcp-config <file>`
 * pair in `agentDefaultArgs.claude`, pointing at a file in Pod's user data, never at
 * anything inside a worktree.
 */
export const POD_MCP_CONFIG_FILE = 'pod-mcp.json'
export const POD_MCP_SERVER_NAME = 'pod-dbt'

/** Why quoted: the setting is tokenized Unix-style, and userData has a space on macOS. */
export function podMcpConfigArgs(configPath: string): string {
  return `--mcp-config ${quoteStartupArg(configPath, 'posix')}`
}

export function hasPodMcpConfigArgs(args: string | undefined, configPath: string): boolean {
  return (args ?? '').includes(podMcpConfigArgs(configPath))
}

export function withPodMcpConfigArgs(args: string | undefined, configPath: string): string {
  if (hasPodMcpConfigArgs(args, configPath)) {
    return args ?? ''
  }
  return [args?.trim(), podMcpConfigArgs(configPath)].filter(Boolean).join(' ')
}

/** Removes only Pod's pair, so the user's own flags stay as typed. */
export function withoutPodMcpConfigArgs(args: string | undefined, configPath: string): string {
  return (args ?? '').split(podMcpConfigArgs(configPath)).join(' ').replace(/\s+/g, ' ').trim()
}
