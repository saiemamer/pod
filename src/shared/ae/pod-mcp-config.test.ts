import { describe, expect, it } from 'vitest'
import { tokenizeStartupCommand } from '../tui-agent-startup-shell'
import { withoutPodMcpConfigArgs, withPodMcpConfigArgs } from './pod-mcp-config'

describe('Pod MCP config args', () => {
  it('keeps a user-data path with an apostrophe in one token, and takes it out again', () => {
    const configPath = "/Users/o'brien/Library/Application Support/Pod/pod-mcp.json"
    const args = withPodMcpConfigArgs('--verbose', configPath)
    const tokens = tokenizeStartupCommand(args, 'posix')
    expect(tokens.ok && tokens.tokens).toEqual(['--verbose', '--mcp-config', configPath])
    expect(withoutPodMcpConfigArgs(args, configPath)).toBe('--verbose')
  })
})
