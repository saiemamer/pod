// First-start smoke: Claude's saved launch arguments carry no Orca bypass default, and the
// new-tab menu does not offer the Mobile Emulator. Needs `pnpm dev` with
// REMOTE_DEBUGGING_PORT=9333 and the pod-smoke group from ui-smoke.mjs (see README.md).
// One screenshot in POD_SMOKE_OUT: first-start-new-tab-menu.
import { createRequire } from 'node:module'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, what) => {
  log(ok ? 'PASS' : 'FAIL', what)
  if (!ok) {
    failures.push(what)
  }
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const pages = browser.contexts().flatMap((c) => c.pages())
let page = null
for (const p of pages) {
  const ok = await p
    .evaluate(() => typeof window.api?.ae?.domains?.list === 'function')
    .catch(() => false)
  if (ok) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae')
}
page.setDefaultTimeout(30000)
await page.keyboard.press('Escape')
await sleep(300)

// 1. Claude's arguments: loading the profile dropped Orca's saved bypass default
const settings = await page.evaluate(() => window.api.settings.get())
const claudeArgs = settings.agentDefaultArgs?.claude
log('agentDefaultArgs.claude:', JSON.stringify(claudeArgs ?? null))
check(settings.podClaudeBypassDefaultCleared === true, 'profile migration ran')
check(
  claudeArgs === undefined || !claudeArgs.trim().startsWith('--dangerously-skip-permissions'),
  'Claude starts without --dangerously-skip-permissions'
)

// 2. new-tab menu on dbt-demo's `master` worktree
const rowY = async (locator) => (await locator.boundingBox())?.y ?? null
const dbtProject = page.getByText('dbt-demo', { exact: true }).first()
const omniProject = page.getByText('omni-demo', { exact: true }).first()
const findDbtWorktreeRow = async () => {
  const top = await rowY(dbtProject)
  const bottom = await rowY(omniProject)
  const rows = page.getByText('master', { exact: true })
  for (let i = 0; i < (await rows.count()); i += 1) {
    const y = await rowY(rows.nth(i))
    if (top !== null && y !== null && y > top && (bottom === null || y < bottom)) {
      return rows.nth(i)
    }
  }
  return null
}
let worktreeRow = await findDbtWorktreeRow()
if (!worktreeRow) {
  await dbtProject.click()
  await sleep(800)
  worktreeRow = await findDbtWorktreeRow()
}
if (!worktreeRow) {
  throw new Error('no worktree row under dbt-demo; run ui-smoke.mjs first')
}
await worktreeRow.click()
await sleep(1500)
await page.getByRole('button', { name: 'New tab' }).first().click()
const menu = page.getByRole('menu').first()
await menu.waitFor({ state: 'visible' })
const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.split('\n')[0])
log('new-tab menu:', JSON.stringify(items))
await page.screenshot({ path: `${OUT}/first-start-new-tab-menu.png` })
check(
  items.some((t) => /terminal/i.test(t)),
  'menu still offers a terminal'
)
check(!items.some((t) => /emulator/i.test(t)), 'menu does not offer the Mobile Emulator')
check(!/simulator|emulator/i.test(await menu.innerText()), 'no emulator intro in the menu')
await page.keyboard.press('Escape')

await browser.close()
if (failures.length) {
  console.error(`FAILED: ${failures.join('; ')}`)
  process.exit(1)
}
log('first-start smoke passed')
