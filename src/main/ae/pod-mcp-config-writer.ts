import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { POD_MCP_CONFIG_FILE, POD_MCP_SERVER_NAME } from '../../shared/ae/pod-mcp-config'
import { findOnPath } from './dbt/dbt-runner'

export type PodMcpConfigResult = {
  configPath: string
  /** What Claude Code runs: the pod-dbt-mcp binary, or node with the server script. */
  command: string
  args: string[]
}

/**
 * Pod: writes `<userData>/pod-mcp.json` for Claude Code's `--mcp-config`. The server is
 * the user-installed `pod-dbt-mcp` (Settings > Analytics Tools, else PATH); `orcaBin`
 * pins the CLI it calls when Pod knows its own launcher.
 */
export async function writePodMcpConfig(options: {
  userDataPath: string
  override?: string
  env: NodeJS.ProcessEnv
  orcaBin: string | null
}): Promise<PodMcpConfigResult> {
  const override = options.override?.trim()
  if (override && !existsSync(override)) {
    throw new Error(
      `pod-dbt-mcp not found at ${override}. Fix its path in Settings > Analytics Tools.`
    )
  }
  const server = override || findOnPath('pod-dbt-mcp', options.env.PATH)
  if (!server) {
    throw new Error(
      'pod-dbt-mcp not found. Install it (packages/pod-dbt-mcp/README.md in the Pod repository), or set its path in Settings > Analytics Tools.'
    )
  }
  // Why node for a .js path: a checkout's server script need not be executable.
  const launch = server.endsWith('.js')
    ? { command: 'node', args: [server] }
    : { command: server, args: [] }
  const configPath = join(options.userDataPath, POD_MCP_CONFIG_FILE)
  const entry = {
    ...launch,
    ...(options.orcaBin ? { env: { POD_ORCA_BIN: options.orcaBin } } : {})
  }
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `${JSON.stringify({ mcpServers: { [POD_MCP_SERVER_NAME]: entry } }, null, 2)}\n`,
    'utf8'
  )
  return { configPath, ...launch }
}
