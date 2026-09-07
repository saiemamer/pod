import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const PROJECT_NOTE =
  'The project is the nearest dbt_project.yml at or above the current directory (or one level below the repo root); --project overrides it.'
const WAREHOUSE_NOTE =
  'Runs a query against the warehouse, which BigQuery bills. The row limit is capped at 500.'

/** Pod: the same dbt operations the editor uses, for agents working in a dbt worktree. */
export const DBT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['dbt', 'project'],
    summary: 'Show which dbt project, binary, target and profiles Pod uses from here',
    usage: 'orca dbt project [--project <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project'],
    examples: ['orca dbt project --json'],
    notes: [PROJECT_NOTE, 'Secret values and env values are never printed.']
  },
  {
    path: ['dbt', 'list-models'],
    summary: 'List models from the project manifest, parsing first if there is none',
    usage: 'orca dbt list-models [--filter <text>] [--refresh] [--project <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'filter', 'refresh', 'project'],
    examples: ['orca dbt list-models --filter zendesk --json'],
    notes: [PROJECT_NOTE, 'Pass --refresh to run `dbt parse` again before answering.']
  },
  {
    path: ['dbt', 'model-info'],
    summary: 'Show one model: file, materialization, columns, direct parents and children',
    usage: 'orca dbt model-info --model <name> [--refresh] [--project <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'model', 'refresh', 'project'],
    examples: ['orca dbt model-info --model zendesk_tickets_latest_update --json'],
    notes: [PROJECT_NOTE]
  },
  {
    path: ['dbt', 'lineage'],
    summary: 'Upstream and downstream nodes of a model from the manifest, to a depth',
    usage: 'orca dbt lineage --model <name> [--depth <n>] [--refresh] [--project <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'model', 'depth', 'refresh', 'project'],
    examples: ['orca dbt lineage --model fct_orders --depth 2 --json'],
    notes: [
      PROJECT_NOTE,
      'Each node lists its columns (from the catalog, the manifest, the SQL, or its parents).'
    ]
  },
  {
    path: ['dbt', 'column-lineage'],
    summary: 'Which upstream columns feed a column and which downstream columns it feeds',
    usage:
      'orca dbt column-lineage --model <name> --column <name> [--depth <n>] [--refresh] [--project <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'model', 'column', 'depth', 'refresh', 'project'],
    examples: ['orca dbt column-lineage --model fct_orders --column customer_id --json'],
    notes: [
      PROJECT_NOTE,
      'Reads target/manifest.json, target/catalog.json and the compiled SQL; runs sqlglot through the python in Settings > Analytics Tools, or matches column names when sqlglot is missing. Nothing touches the warehouse.'
    ]
  },
  {
    path: ['dbt', 'show'],
    summary: 'Preview rows from a model or inline SQL through dbt show',
    usage:
      'orca dbt show (--model <name> | --sql <text>) [--limit <n>] [--target <name>] [--project <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'model', 'sql', 'limit', 'target', 'project'],
    examples: [
      'orca dbt show --model fct_orders --limit 20',
      'orca dbt show --sql "select count(*) as n from {{ ref(\'fct_orders\') }}" --json'
    ],
    notes: [WAREHOUSE_NOTE, PROJECT_NOTE]
  },
  {
    path: ['dbt', 'compile'],
    summary: 'Print the compiled SQL of a model or of inline Jinja SQL',
    usage:
      'orca dbt compile (--model <name> | --sql <text>) [--target <name>] [--project <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'model', 'sql', 'target', 'project'],
    examples: ['orca dbt compile --model fct_orders'],
    notes: [PROJECT_NOTE]
  },
  {
    path: ['dbt', 'parse'],
    summary: 'Run dbt parse so the manifest under target/ is current',
    usage: 'orca dbt parse [--target <name>] [--project <dir>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'target', 'project'],
    examples: ['orca dbt parse --json'],
    notes: [PROJECT_NOTE]
  }
]
