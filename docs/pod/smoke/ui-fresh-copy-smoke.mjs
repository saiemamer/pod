// Fresh-copy smoke: a dbt repo that lists a package, installed in the main copy only.
// Create a new workspace (a git worktree) through Pod, wait for Pod to prepare it on its
// own (packages copied from the main copy, then parse), open orders.sql there and press
// Cmd+Alt+L: the canvas must draw, with no raw dbt error text. Without the preparation
// the stand-in dbt refuses to parse ("0 package(s) installed") and no canvas appears.
// Needs `pnpm dev` with REMOTE_DEBUGGING_PORT=9333, the stand-in dbt at
// ~/Projects/pod-smoke/bin/dbt, and ui-lineage-smoke.mjs run once (it writes the models).
import { createRequire } from 'node:module'
import { openExplorerFile } from './smoke-sidebar.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const DBT_STUB = process.env.POD_SMOKE_DBT ?? `${PARENT}/bin/dbt`
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const repo = `${PARENT}/dbt-demo`
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

// 0. the main copy lists a package and has it installed; only packages.yml is committed
if (!existsSync(`${repo}/models/marts/orders.sql`)) {
  throw new Error('run ui-lineage-smoke.mjs once first: it writes the smoke models')
}
writeFileSync(
  `${repo}/packages.yml`,
  'packages:\n  - package: dbt-labs/dbt_utils\n    version: 1.3.0\n'
)
mkdirSync(`${repo}/dbt_packages/dbt_utils`, { recursive: true })
if (git('status', '--porcelain', '--', 'packages.yml').trim()) {
  git('add', 'packages.yml')
  git('-c', 'user.email=smoke@pod', '-c', 'user.name=smoke', 'commit', '-qm', 'smoke: packages')
  log('committed packages.yml')
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const page = (
  await Promise.all(
    browser
      .contexts()
      .flatMap((c) => c.pages())
      .map(async (p) =>
        (await p
          .evaluate(() => typeof window.api?.ae?.dbt?.prepare === 'function')
          .catch(() => false))
          ? p
          : null
      )
  )
).find(Boolean)
if (!page) {
  throw new Error('no page with window.api.ae.dbt.prepare (is this build older than the change?)')
}
page.setDefaultTimeout(30000)
await page.evaluate((dbt) => window.api.settings.set({ toolCmdOverrides: { dbt } }), DBT_STUB)

// 1. a new workspace of dbt-demo, created the way the New Workspace dialog does
const name = `fresh-${Date.now().toString(36)}`
const created = await page.evaluate(
  async ([repoPath, wtName]) => {
    const target = (await window.api.repos.list()).find((r) => r.path === repoPath)
    if (!target) {
      throw new Error(`repo ${repoPath} not imported; run ui-lineage-smoke.mjs first`)
    }
    const result = await window.api.worktrees.create({ repoId: target.id, name: wtName })
    return { path: result.worktree.path, id: result.worktree.id }
  },
  [repo, name]
)
log('created', created.path)

try {
  // 2. Pod prepares it unasked: packages copied from the main copy, then the manifest
  for (let i = 0; i < 60 && !existsSync(`${created.path}/target/manifest.json`); i += 1) {
    await sleep(1000)
  }
  if (!existsSync(`${created.path}/dbt_packages/dbt_utils`)) {
    throw new Error('the new copy has no packages: preparation did not run')
  }
  if (!existsSync(`${created.path}/target/manifest.json`)) {
    throw new Error('the new copy has no manifest: preparation did not parse')
  }
  const readiness = await page.evaluate(
    (path) => window.api.ae.dbt.readiness({ path }),
    `${created.path}/models/marts/orders.sql`
  )
  log('readiness', JSON.stringify(readiness.readiness))

  // 3. open orders.sql in the new workspace and press Cmd+Alt+L
  await page.getByText(name, { exact: true }).first().click()
  await sleep(1500)
  await openExplorerFile(page, ['models', 'marts', 'orders.sql'])
  const editor = page.locator('.monaco-editor .view-lines').filter({ visible: true }).first()
  await editor.waitFor({ state: 'visible', timeout: 120000 })
  await editor.click()
  await page.keyboard.press(`${MOD}+Alt+L`)
  // Visible only: the main copy's workspace keeps its own dock mounted, hidden.
  const dock = page.locator('[data-testid="pod-dbt-dock"]').filter({ visible: true })
  await dock.waitFor({ state: 'visible' })
  await dock.locator('[data-testid="pod-lineage-node"]').first().waitFor({ state: 'visible' })
  const text = await dock.innerText()
  if (/DbtGraphNotReadyError|DbtRunError/.test(text)) {
    throw new Error(`raw dbt error text in the dock: ${text.slice(0, 200)}`)
  }
  await page.screenshot({ path: `${OUT}/pod-fresh-copy-lineage.png` })
  log('lineage drew in the fresh copy; screenshot', `${OUT}/pod-fresh-copy-lineage.png`)
} finally {
  // The workspace goes again so the next run starts from the sidebar it found.
  await page.evaluate(
    (worktreeId) => window.api.worktrees.remove({ worktreeId, force: true, skipArchive: true }),
    created.id
  )
  await browser.close()
}
