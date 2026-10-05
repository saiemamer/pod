// Catalog smoke: the Database tab under a personal target, through the stand-in dbt's
// POD_STUB_DOCS modes. Checks the empty state says what Generate catalog does, a failed
// run shows a plain error with dbt's text behind Details and survives leaving the tab,
// a run with refused datasets is a result that lists them, and a model the catalog
// lacks is still listed, marked not built. Needs `pnpm dev` with REMOTE_DEBUGGING_PORT=9333
// and the stand-in dbt at ~/Projects/pod-smoke/bin/dbt (see README.md); run
// ui-lineage-smoke.mjs once first so the smoke repo has its models.
import { createRequire } from 'node:module'
import { primaryWorktreeRow } from './smoke-sidebar.mjs'
import { rmSync } from 'node:fs'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const DBT_STUB = process.env.POD_SMOKE_DBT ?? `${PARENT}/bin/dbt`
const repo = `${PARENT}/dbt-demo`
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = (ok, what) => {
  if (!ok) {
    throw new Error(`FAIL: ${what}`)
  }
  log('ok:', what)
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
let page = null
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  const ok = await p
    .evaluate(() => typeof window.api?.ae?.dbt?.catalogRun === 'function')
    .catch(() => false)
  if (ok) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae.dbt.catalogRun (is this branch running?)')
}
page.setDefaultTimeout(30000)

// 1. settings: the stand-in dbt, told to fail the catalog
const settings = await page.evaluate(() => window.api.settings.get())
const previousAeDbt = settings.aeDbt ?? {}
const setDocsMode = (mode) =>
  page.evaluate(
    ([dbt, aeDbt, docs]) =>
      window.api.settings.set({
        toolCmdOverrides: { dbt },
        aeDbt: { ...aeDbt, env: { ...aeDbt.env, POD_STUB_DOCS: docs } }
      }),
    [DBT_STUB, previousAeDbt, mode]
  )
await setDocsMode('broken')

try {
  // 2. the dbt-demo worktree, with no catalog on disk
  rmSync(`${repo}/target/catalog.json`, { force: true })
  await (await primaryWorktreeRow(page, repo)).click()
  await sleep(1500)

  // Why via Explorer: switching tabs remounts the panel, which re-reads the tree.
  const openDatabaseTab = async () => {
    await page.locator('[aria-label^="Explorer"]').first().click()
    await sleep(400)
    await page.locator('[aria-label^="Database"]').first().click()
    await page.locator('[data-testid="pod-dbt-explorer"]').waitFor({ state: 'visible' })
    await sleep(800)
  }
  await openDatabaseTab()
  const panel = page.locator('[data-testid="pod-dbt-explorer"]')

  // 3. the empty state says what the button does (a rerun in the same session shows the
  // last failure instead, which step 5 checks)
  const empty = panel.locator('[data-testid="pod-dbt-catalog-empty"]')
  if (await empty.isVisible()) {
    const text = await empty.innerText()
    check(
      /reads table and column information from the warehouse/.test(text),
      'empty state explains'
    )
    check(/a minute or two/.test(text), 'empty state says how long')
    await page.screenshot({ path: `${OUT}/catalog-1-empty.png` })
    await empty.getByRole('button', { name: 'Generate catalog' }).click()
  } else {
    log('no empty state: an earlier run this session left its outcome')
    await panel.getByRole('button', { name: 'Try again' }).click()
  }

  // 4. running shows elapsed time, then a plain error
  const running = panel.locator('[data-testid="pod-dbt-catalog-running"]')
  await running.waitFor({ state: 'visible', timeout: 5000 })
  check(/\d+s/.test(await running.innerText()), 'running shows elapsed time')
  const failed = panel.locator('[data-testid="pod-dbt-catalog-failed"]')
  await failed.waitFor({ state: 'visible', timeout: 30000 })
  const failedText = await failed.innerText()
  check(/Stopped at model order_summary/.test(failedText), 'error names the model')
  check(/Not found: Table proj:dbt\.orders/.test(failedText), 'error names what is missing')
  check(!/Warning/.test(failedText), 'no Python warning in the error')
  await failed.getByRole('button', { name: 'Details' }).click()
  check(/Encountered an error/.test(await failed.innerText()), "details hold dbt's text")
  await page.screenshot({ path: `${OUT}/catalog-2-failed.png` })

  // 5. the error survives leaving the tab
  await openDatabaseTab()
  check(await failed.isVisible(), 'the error is still there after switching tabs')

  // 6. under a personal target with refused datasets: a result, and every model listed
  await setDocsMode('unbuilt')
  await failed.getByRole('button', { name: 'Try again' }).click()
  const partial = panel.locator('[data-testid="pod-dbt-catalog-partial"]')
  await partial.waitFor({ state: 'visible', timeout: 30000 })
  check(/2 datasets could not be read/.test(await partial.innerText()), 'skipped datasets counted')
  await partial.getByRole('button', { name: 'Show which' }).click()
  const listed = await partial.innerText()
  check(listed.includes('proj:finance') && listed.includes('proj:hr'), 'skipped datasets listed')
  const ordersRow = panel
    .locator('[data-testid="pod-dbt-explorer-relation"]')
    .filter({ has: page.getByText('orders', { exact: true }) })
  await ordersRow.first().waitFor({ state: 'visible', timeout: 10000 })
  check(
    (await ordersRow.first().locator('[data-testid="pod-dbt-explorer-not-built"]').count()) === 1,
    'orders is listed and marked not built'
  )
  const stgRow = panel
    .locator('[data-testid="pod-dbt-explorer-relation"]')
    .filter({ has: page.getByText('stg_orders', { exact: true }) })
  check(
    (await stgRow.first().locator('[data-testid="pod-dbt-explorer-not-built"]').count()) === 0,
    'stg_orders is built and carries no mark'
  )
  await page.screenshot({ path: `${OUT}/catalog-3-partial.png` })
} finally {
  // Leave the full stand-in catalog behind for the other smokes.
  await page.evaluate((aeDbt) => window.api.settings.set({ aeDbt }), previousAeDbt)
  await page.evaluate(
    (path) => window.api.ae.dbt.ensureCatalog({ path, force: true }),
    `${repo}/models/marts/orders.sql`
  )
  await browser.close()
}
log('catalog smoke passed')
