// First-start smoke: Claude's saved launch arguments carry no Orca bypass default, and the
// new-tab menu does not offer the Mobile Emulator. Needs `pnpm dev` with
// REMOTE_DEBUGGING_PORT=9333 and the pod-smoke group from ui-smoke.mjs (see README.md).
// One screenshot in POD_SMOKE_OUT: first-start-new-tab-menu.
import { createRequire } from 'node:module'
import { primaryWorktreeRow } from './smoke-sidebar.mjs'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
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
await (await primaryWorktreeRow(page, `${PARENT}/dbt-demo`)).click()
await sleep(1500)
await page.getByRole('button', { name: 'New tab' }).first().click()
const menu = page.getByRole('menu').first()
await menu.waitFor({ state: 'visible' })
// Why one read: the menu can close between two reads, and the second then times out.
const { menuText, items } = await menu.evaluate((el) => ({
  menuText: el.innerText,
  items: [...el.querySelectorAll('[role="menuitem"]')].map((item) => item.innerText.split('\n')[0])
}))
log('new-tab menu:', JSON.stringify(items))
await page.screenshot({ path: `${OUT}/first-start-new-tab-menu.png` })
check(
  items.some((t) => /terminal/i.test(t)),
  'menu still offers a terminal'
)
check(!items.some((t) => /emulator/i.test(t)), 'menu does not offer the Mobile Emulator')
check(!/simulator|emulator/i.test(menuText), 'no emulator intro in the menu')
await page.keyboard.press('Escape')

await browser.close()
if (failures.length) {
  console.error(`FAILED: ${failures.join('; ')}`)
  process.exit(1)
}
log('first-start smoke passed')
