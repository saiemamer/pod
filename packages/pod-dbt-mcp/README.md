# pod-dbt-mcp

Pod's six dbt tools as an MCP server over stdio, for agents that speak MCP rather than the `orca` CLI: `dbt_list_models`, `dbt_model_info`, `dbt_lineage`, `dbt_column_lineage`, `dbt_show` and `dbt_compile`. Each tool runs `orca dbt <command> --json` against the running Pod, so the answers come from the same project discovery, env, manifest and sqlglot code as the editor. Pod must be running, and `dbt_show` queries the warehouse.

## Install

The package is not on npm. From a clone of the Pod repository (Node 20 or newer):

```sh
pnpm --dir packages/pod-dbt-mcp install --prod
```

Then either set Settings > Analytics Tools > "pod-dbt-mcp command" to `<clone>/packages/pod-dbt-mcp/src/server.js`, or link it onto your PATH (`ln -s "$PWD/packages/pod-dbt-mcp/src/server.js" /usr/local/bin/pod-dbt-mcp`; Node follows the link back to the package's own `node_modules`).

## Claude Code agents Pod starts

Turn on Settings > Analytics Tools > "dbt tools for Claude Code (MCP)". Pod writes `pod-mcp.json` into its user data folder and adds `--mcp-config '<that file>'` to Claude's default arguments (Settings > Agents). Turning it off removes only that pair. Pod never writes MCP config into a repository or worktree. The flag applies to every Claude launch, so leave it off when you run agents on SSH hosts, which do not have the file.

## Other MCP clients

```json
{
  "mcpServers": {
    "pod-dbt": {
      "command": "node",
      "args": ["<clone>/packages/pod-dbt-mcp/src/server.js"],
      "env": { "POD_ORCA_BIN": "/usr/local/bin/pod" }
    }
  }
}
```

`POD_ORCA_BIN` names Pod's CLI to call; without it the server uses `pod` from PATH, the shell command Pod installs (`orca` outside Pod's terminals may be stock Orca's). Each tool takes an optional `path` inside the dbt project (default: the directory the server started in) and `project` when discovery picks the wrong one.

## Test

```sh
pnpm --dir packages/pod-dbt-mcp install
pnpm --dir packages/pod-dbt-mcp test
```

The tests start the server and call it through the MCP client, with a shell stand-in for `orca` (`test/orca-stub.sh`). `docs/pod/smoke/ui-mcp-smoke.mjs` covers the settings switch and a real call through `orca` and a running Pod.
