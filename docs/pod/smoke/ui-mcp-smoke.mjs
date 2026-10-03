// Phase 4 smoke: the "dbt tools for Claude Code (MCP)" switch in Settings > Analytics
// Tools, end to end. Turning it on must write <userData>/pod-mcp.json and add
// --mcp-config for it to Claude's default arguments, keeping the user's own flags; the
// server that file names must answer a dbt tool through the real orca CLI and this Pod;
// turning it off must remove only Pod's pair; a missing server must leave it off with a
// message. Needs `pnpm dev` with REMOTE_DEBUGGING_PORT=9333, the CLI bundle
// (`pnpm build:cli`), `pnpm --dir packages/pod-dbt-mcp install`, and the stand-in dbt at
// ~/Projects/pod-smoke/bin/dbt (see README.md). Screenshots go to POD_SMOKE_OUT.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const PACKAGE = join(process.cwd(), 'packages/pod-dbt-mcp')
const packageRequire = createRequire(join(PACKAGE, 'package.json'))
const { Client } = packageRequire('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = packageRequire('@modelcontextprotocol/sdk/client/stdio.js')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const SERVER = join(PACKAGE, 'src/server.js')
const ORCA = join(process.cwd(), 'out/bin/orca')
// Why not --dangerously-skip-permissions: that is Claude's built-in default, and step 5 needs both.
const USER_FLAG = '--verbose'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = (ok, message) => {
  if (!ok) {
    throw new Error(message)
  }
  log('ok:', message)
}

for (const [path, hint] of [
  [join(process.cwd(), 'out/cli/index.js'), 'run pnpm build:cli'],
  [join(PACKAGE, 'node_modules'), 'run pnpm --dir packages/pod-dbt-mcp install']
]) {
  if (!existsSync(path)) {
    throw new Error(`${path} missing; ${hint}`)
  }
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
let page = null
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  if (
    await p.evaluate(() => typeof window.api?.ae?.mcp?.configPath === 'function').catch(() => false)
  ) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae.mcp (is this build older than the MCP switch?)')
}
page.setDefaultTimeout(20000)

const settings = await page.evaluate(() => window.api.settings.get())
const previous = {
  toolCmdOverrides: settings.toolCmdOverrides ?? {},
  agentDefaultArgs: settings.agentDefaultArgs ?? {}
}
const configPath = await page.evaluate(() => window.api.ae.mcp.configPath())
const claudeArgs = async () =>
  (await page.evaluate(() => window.api.settings.get())).agentDefaultArgs?.claude ?? ''
const setTools = (extra) =>
  page.evaluate((overrides) => window.api.settings.set({ toolCmdOverrides: overrides }), {
    ...previous.toolCmdOverrides,
    dbt: `${PARENT}/bin/dbt`,
    ...extra
  })
rmSync(configPath, { force: true })
await setTools({ dbtMcp: SERVER })
await page.evaluate((args) => window.api.settings.set({ agentDefaultArgs: args }), {
  ...previous.agentDefaultArgs,
  claude: USER_FLAG
})

const toggle = page.getByRole('switch', { name: 'dbt tools for Claude Code (MCP)' })
// Why reopen after a write from here: settings:changed skips the window that made the change,
// and opening Settings re-reads them.
const openTools = async () => {
  const back = page.getByText('Back to app', { exact: true })
  if (await back.isVisible().catch(() => false)) {
    await back.click()
  }
  await page.keyboard.press('Escape')
  await page.locator('[aria-label="Settings"]').first().click()
  // Why "Tools": "Analytics Tools" is the sidebar group heading; the page link under it is Tools.
  await page.getByText('Tools', { exact: true }).first().click()
  await toggle.scrollIntoViewIfNeeded()
}

try {
  // 1. Settings > Analytics Tools: the switch is off
  await openTools()
  check((await toggle.getAttribute('aria-checked')) === 'false', 'the MCP switch starts off')
  await page.screenshot({ path: `${OUT}/mcp-1-off.png` })

  // 2. on: the config file and the flag, the user's own flag kept
  await toggle.click()
  await page.waitForFunction(
    (path) =>
      window.api.settings.get().then((s) => (s.agentDefaultArgs?.claude ?? '').includes(path)),
    configPath
  )
  const onArgs = await claudeArgs()
  check(
    onArgs === `${USER_FLAG} --mcp-config '${configPath}'`,
    `Claude's default arguments gain --mcp-config (${onArgs})`
  )
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const entry = config.mcpServers?.['pod-dbt']
  check(
    entry?.command === 'node' && entry.args?.[0] === SERVER,
    `${configPath} names the server (${JSON.stringify(entry)})`
  )
  check((await toggle.getAttribute('aria-checked')) === 'true', 'the switch shows on')
  await page.screenshot({ path: `${OUT}/mcp-2-on.png` })

  // 3. the server the file names answers a dbt tool through orca and this Pod
  const client = new Client({ name: 'pod-mcp-smoke', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      cwd: `${PARENT}/dbt-demo`,
      env: { ...process.env, POD_ORCA_BIN: ORCA, ...entry.env }
    })
  )
  const listed = await client.callTool({ name: 'dbt_list_models', arguments: {} })
  const models = listed.isError ? null : JSON.parse(listed.content[0].text)
  await client.close()
  check(
    models?.models?.some((model) => model.name === 'orders'),
    `dbt_list_models answers from the dbt-demo project (${listed.content[0].text.slice(0, 120)})`
  )

  // 4. off: only Pod's pair goes
  await toggle.click()
  await page.waitForFunction(
    (path) =>
      window.api.settings.get().then((s) => !(s.agentDefaultArgs?.claude ?? '').includes(path)),
    configPath
  )
  check((await claudeArgs()) === USER_FLAG, "turning it off leaves the user's flag alone")

  // 5. with no Claude setting of the user's own, on and off leaves none behind
  const { claude: _userFlag, ...withoutClaude } = previous.agentDefaultArgs
  await page.evaluate((args) => window.api.settings.set({ agentDefaultArgs: args }), withoutClaude)
  await openTools()
  const hasClaudeKey = () =>
    page.evaluate(() =>
      window.api.settings.get().then((s) => Object.hasOwn(s.agentDefaultArgs ?? {}, 'claude'))
    )
  check(!(await hasClaudeKey()), 'Claude follows the built-in default arguments')
  await toggle.click()
  await page.waitForFunction(
    (path) =>
      window.api.settings.get().then((s) => (s.agentDefaultArgs?.claude ?? '').includes(path)),
    configPath
  )
  const defaultOnArgs = await claudeArgs()
  check(
    defaultOnArgs.startsWith('--dangerously-skip-permissions --mcp-config'),
    `on adds the pair to the built-in default (${defaultOnArgs})`
  )
  await toggle.click()
  await page.waitForFunction(
    () => window.api.settings.get().then((s) => !Object.hasOwn(s.agentDefaultArgs ?? {}, 'claude')),
    undefined,
    { timeout: 5000 }
  )
  check(!(await hasClaudeKey()), 'off removes the claude key, so the default applies again')
  await page.evaluate((args) => window.api.settings.set({ agentDefaultArgs: args }), {
    ...withoutClaude,
    claude: USER_FLAG
  })
  await openTools()

  // 6. a server path that does not exist keeps the switch off and says why
  await setTools({ dbtMcp: '/nonexistent/pod-dbt-mcp' })
  await sleep(500)
  await toggle.click()
  await page.getByText('pod-dbt-mcp not found at /nonexistent/pod-dbt-mcp').waitFor()
  check((await claudeArgs()) === USER_FLAG, 'a missing server adds no flag')
  check((await toggle.getAttribute('aria-checked')) === 'false', 'and the switch stays off')
  await page.screenshot({ path: `${OUT}/mcp-3-missing-server.png` })
} finally {
  await page.evaluate((input) => window.api.settings.set(input), previous)
  rmSync(configPath, { force: true })
  await page.keyboard.press('Escape')
}
log('done; screenshots in', OUT)
await browser.close()
