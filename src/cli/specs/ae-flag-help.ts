/** Pod: flag help for `orca dbt` and `orca omni`, where --model, --depth and --limit mean something else than the global flags. */

const PROJECT = '--project <dir>        dbt project folder; default is the nearest dbt_project.yml'
const REFRESH = '--refresh              Run dbt parse first so the manifest is current'
const DBT_MODEL = '--model <name>         dbt model name'
const DEPTH = '--depth <n>            Levels to follow up and down; default from the dbt settings'
const TARGET = '--target <name>        dbt target; default from the dbt settings'
const SQL = '--sql <text>           Inline SQL, Jinja allowed, instead of --model'
const OMNI_MODEL = '--model <id>           Omni model id; default is OMNI_MODEL_ID'

export const AE_COMMAND_FLAG_HELP: Record<string, Record<string, string>> = {
  'dbt project': { project: PROJECT },
  'dbt list-models': {
    filter: '--filter <text>        Only models whose name contains this text',
    refresh: REFRESH,
    project: PROJECT
  },
  'dbt model-info': { model: DBT_MODEL, refresh: REFRESH, project: PROJECT },
  'dbt lineage': { model: DBT_MODEL, depth: DEPTH, refresh: REFRESH, project: PROJECT },
  'dbt column-lineage': {
    model: DBT_MODEL,
    column: '--column <name>        Column of that model to trace',
    depth: DEPTH,
    refresh: REFRESH,
    project: PROJECT
  },
  'dbt show': {
    model: DBT_MODEL,
    sql: SQL,
    limit: '--limit <n>            Rows to preview, at most 500; default from the dbt settings',
    target: TARGET,
    project: PROJECT
  },
  'dbt compile': { model: DBT_MODEL, sql: SQL, target: TARGET, project: PROJECT },
  'dbt parse': { target: TARGET, project: PROJECT },
  'omni branch': {
    create: "--create               Create the branch if it doesn't exist",
    model: OMNI_MODEL
  },
  'omni validate': { model: OMNI_MODEL },
  'omni commit': {
    message: '--message <text>       Commit message',
    model: OMNI_MODEL
  }
}
