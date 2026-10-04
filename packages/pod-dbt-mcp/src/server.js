#!/usr/bin/env node
// Pod's dbt tools as an MCP server over stdio. Each tool runs `orca dbt <command> --json`
// against the running Pod, so the answers come from the same project discovery, env,
// manifest and sqlglot code the editor and `orca dbt` use. Pod must be running.
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// Why `pod`: this server can run outside Pod's terminals, where `orca` may be stock Orca's.
const ORCA = process.env.POD_ORCA_BIN || 'pod'
// Why eleven minutes: Pod lets a dbt run take ten, and `show` waits on the warehouse.
const TIMEOUT_MS = 11 * 60_000

const location = {
  path: z
    .string()
    .optional()
    .describe(
      'Absolute path of a file or folder inside the dbt project. Defaults to the directory this server was started in.'
    ),
  project: z
    .string()
    .optional()
    .describe('dbt project directory, when discovery from the path picks the wrong one.')
}
const refresh = z.boolean().optional().describe('Run `dbt parse` first so the manifest is current.')
const depth = z.number().int().positive().optional().describe('How many levels to walk.')
const target = z.string().optional().describe('dbt target; defaults to the profile or domain one.')

function runOrca(args, cwd) {
  return new Promise((resolve) => {
    execFile(
      ORCA,
      args,
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // Why stdout first: with --json the CLI prints its error document there and exits 1.
        const text = stdout.trim()
        if (text.startsWith('{')) {
          try {
            resolve(JSON.parse(text))
            return
          } catch {
            // Fall through to the process error.
          }
        }
        const message =
          error?.code === 'ENOENT'
            ? `Could not run ${ORCA}. Turn on Settings > Shell command in Pod, or set POD_ORCA_BIN to Pod's CLI.`
            : stderr.trim() || error?.message || 'orca printed nothing'
        resolve({ ok: false, error: { message } })
      }
    )
  })
}

function flags(input, names) {
  const args = []
  for (const name of names) {
    const value = input[name]
    if (value === undefined || value === null || value === '' || value === false) {
      continue
    }
    args.push(`--${name}`)
    if (value !== true) {
      args.push(String(value))
    }
  }
  return args
}

/** The directory orca runs in: `path` itself, or its folder when an agent names a model file. */
function workingDirectory(path) {
  if (!path) {
    return { cwd: process.cwd() }
  }
  const absolute = resolve(path)
  try {
    return { cwd: statSync(absolute).isDirectory() ? absolute : dirname(absolute) }
  } catch {
    return { error: `${absolute} does not exist. Pass a path inside the dbt project.` }
  }
}

async function callDbt(command, input, names) {
  const { cwd, error } = workingDirectory(input.path)
  if (error) {
    return { isError: true, content: [{ type: 'text', text: error }] }
  }
  const args = ['dbt', command, ...flags(input, [...names, 'project']), '--json']
  const response = await runOrca(args, cwd)
  if (response.ok) {
    return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] }
  }
  return {
    isError: true,
    content: [{ type: 'text', text: response.error?.message ?? 'orca dbt failed' }]
  }
}

const server = new McpServer({ name: 'pod-dbt', version: '0.1.0' })

server.registerTool(
  'dbt_list_models',
  {
    title: 'List dbt models',
    description:
      "List the models in the dbt project's manifest, parsing first if there is none. Reads files only.",
    inputSchema: {
      ...location,
      filter: z.string().optional().describe('Keep models whose name contains this text.'),
      refresh
    },
    annotations: { readOnlyHint: true }
  },
  (input) => callDbt('list-models', input, ['filter', 'refresh'])
)

server.registerTool(
  'dbt_model_info',
  {
    title: 'dbt model info',
    description:
      'One model: file, materialization, columns, direct parents and children. Reads files only.',
    inputSchema: { ...location, model: z.string().describe('Model name.'), refresh },
    annotations: { readOnlyHint: true }
  },
  (input) => callDbt('model-info', input, ['model', 'refresh'])
)

server.registerTool(
  'dbt_lineage',
  {
    title: 'dbt lineage',
    description:
      'Upstream and downstream nodes of a model from the manifest, with each node’s columns. Reads files only.',
    inputSchema: { ...location, model: z.string().describe('Model name.'), depth, refresh },
    annotations: { readOnlyHint: true }
  },
  (input) => callDbt('lineage', input, ['model', 'depth', 'refresh'])
)

server.registerTool(
  'dbt_column_lineage',
  {
    title: 'dbt column lineage',
    description:
      'Which upstream columns feed a column and which downstream columns it feeds, through sqlglot on the compiled SQL (name matching when sqlglot is missing). Reads files only.',
    inputSchema: {
      ...location,
      model: z.string().describe('Model name.'),
      column: z.string().describe('Column name.'),
      depth,
      refresh
    },
    annotations: { readOnlyHint: true }
  },
  (input) => callDbt('column-lineage', input, ['model', 'column', 'depth', 'refresh'])
)

server.registerTool(
  'dbt_show',
  {
    title: 'dbt show',
    description:
      'Preview rows of a model or of inline SQL through `dbt show`. This queries the warehouse, which BigQuery bills; Pod caps the rows at 500.',
    inputSchema: {
      ...location,
      model: z.string().optional().describe('Model name; give this or sql.'),
      sql: z.string().optional().describe('Inline Jinja SQL; give this or model.'),
      limit: z.number().int().positive().max(500).optional().describe('Row limit, 1 to 500.'),
      target
    },
    // Why no readOnlyHint: clients run read-only tools without asking, and this one is billed.
    annotations: { openWorldHint: true }
  },
  (input) => callDbt('show', input, ['model', 'sql', 'limit', 'target'])
)

server.registerTool(
  'dbt_compile',
  {
    title: 'dbt compile',
    description:
      'The compiled SQL of a model or of inline Jinja SQL. Does not query the warehouse.',
    inputSchema: {
      ...location,
      model: z.string().optional().describe('Model name; give this or sql.'),
      sql: z.string().optional().describe('Inline Jinja SQL; give this or model.'),
      target
    },
    annotations: { readOnlyHint: true }
  },
  (input) => callDbt('compile', input, ['model', 'sql', 'target'])
)

await server.connect(new StdioServerTransport())
