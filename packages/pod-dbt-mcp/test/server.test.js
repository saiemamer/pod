import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = import.meta.dirname
const SERVER = join(here, '../src/server.js')
const STUB = join(here, 'orca-stub.sh')

let dir
let log
let client

async function connect(orca) {
  client = new Client({ name: 'pod-dbt-mcp-test', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      cwd: dir,
      env: { PATH: process.env.PATH, POD_ORCA_BIN: orca, ORCA_STUB_LOG: log }
    })
  )
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pod-dbt-mcp-')))
  log = join(dir, 'orca.log')
})

afterEach(async () => {
  await client?.close()
  rmSync(dir, { recursive: true, force: true })
})

// Why: listing builds every tool's JSON schema from zod, so an SDK/zod mismatch fails here.
test('offers the six dbt tools', async () => {
  await connect(STUB)
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'dbt_column_lineage',
    'dbt_compile',
    'dbt_lineage',
    'dbt_list_models',
    'dbt_model_info',
    'dbt_show'
  ])
})

test('runs orca dbt with the flags the CLI takes, in the path the agent names', async () => {
  await connect(STUB)
  const project = join(dir, 'dbt-demo')
  const result = await client.callTool({
    name: 'dbt_lineage',
    arguments: { path: dir, model: 'orders', depth: 2, refresh: true }
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(JSON.parse(result.content[0].text).nodes.length, 2)
  await client.callTool({
    name: 'dbt_show',
    arguments: { path: dir, sql: 'select 1 as n', limit: 5, project }
  })
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    `${dir}|dbt lineage --model orders --depth 2 --refresh --json`,
    `${dir}|dbt show --sql select 1 as n --limit 5 --project ${project} --json`
  ])
})

test('runs in the folder of a model file, and names a path that does not exist', async () => {
  await connect(STUB)
  const models = join(dir, 'models')
  mkdirSync(models)
  writeFileSync(join(models, 'orders.sql'), 'select 1')
  const result = await client.callTool({
    name: 'dbt_model_info',
    arguments: { path: join(models, 'orders.sql'), model: 'orders' }
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    `${models}|dbt model-info --model orders --json`
  ])
  const missing = await client.callTool({
    name: 'dbt_list_models',
    arguments: { path: join(dir, 'gone') }
  })
  assert.equal(missing.isError, true)
  assert.match(missing.content[0].text, /gone does not exist/)
})

test("passes Pod's error message back as a tool error", async () => {
  await connect(STUB)
  const result = await client.callTool({ name: 'dbt_compile', arguments: { model: 'broken' } })
  assert.equal(result.isError, true)
  assert.equal(result.content[0].text, 'Compilation Error in model broken')
})

test('names the missing orca command instead of failing silently', async () => {
  await connect(join(dir, 'no-such-orca'))
  const result = await client.callTool({ name: 'dbt_list_models', arguments: {} })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /no-such-orca.*POD_ORCA_BIN/)
})
