// Start-notice smoke: with a value Pod cannot read, a reload shows the one-time notice listing it,
// its button opens the screen where the first value is entered, and the next reload shows nothing.
// Needs `pnpm dev -- --use-mock-keychain` with REMOTE_DEBUGGING_PORT=9333 and a value sealed under
// the real Keychain, such as a pod-smoke domain secret saved by a build without the switch (see
// README.md). Two screenshots in POD_SMOKE_OUT: start-notice-1-shown, start-notice-2-opened.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { leaveSettings } from './smoke-sidebar.mjs'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const USER_DATA =
  process.env.POD_SMOKE_USER_DATA ?? `${process.env.HOME}/Library/Application Support/orca-dev`
const SHOWN_FILE = join(USER_DATA, 'pod-start-notice-shown.json')
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const TITLE = 'Pod could not read some saved values'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (ok, what) => {
  log(ok ? 'PASS' : 'FAIL', what)
  if (!ok) {
    failures.push(what)
  }
}

async function findPage(browser) {
  for (const p of browser.contexts().flatMap((c) => c.pages())) {
    const ok = await p
      .evaluate(() => typeof window.api?.ae?.startNotice?.take === 'function')
      .catch(() => false)
    if (ok) {
      return p
    }
  }
  throw new Error('no page with window.api.ae.startNotice')
}

async function reload(page) {
  await page.reload()
  await page.waitForFunction(() => typeof window.api?.ae?.domains?.list === 'function')
  await sleep(4000)
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const page = await findPage(browser)
page.setDefaultTimeout(30000)
const wasShown = existsSync(SHOWN_FILE)

try {
  const unreadable = await page.evaluate(async () => {
    const domains = []
    for (const d of await window.api.ae.domains.list()) {
      const names = await window.api.ae.domains.unreadableSecrets({ domainId: d.id })
      if (names.length > 0) {
        domains.push({ name: d.name, names })
      }
    }
    return {
      credentials: await window.api.ae.credentials.leftBehind(),
      domains,
      settings: await window.api.ae.settings.unreadableSecrets()
    }
  })
  log('unreadable:', JSON.stringify(unreadable))
  const total =
    unreadable.credentials.length + unreadable.domains.length + unreadable.settings.length
  if (total === 0) {
    throw new Error('nothing unreadable in this build: the notice has nothing to list')
  }

  // 1. a start with the record gone shows the notice
  rmSync(SHOWN_FILE, { force: true })
  await reload(page)
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: TITLE })
  await toast.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  check(await toast.isVisible(), 'the notice shows')
  const text = (await toast.innerText().catch(() => '')).replace(/\s+/g, ' ')
  log('notice:', text)
  check(text.includes('Orca or an earlier Pod saved them'), 'it names Orca as the app that sealed')
  for (const domain of unreadable.domains) {
    check(text.includes(`in the ${domain.name} domain`), `it lists the ${domain.name} secrets`)
  }
  check(existsSync(SHOWN_FILE), 'Pod records the notice as shown')
  await page.screenshot({ path: `${OUT}/start-notice-1-shown.png` })

  // 2. the button opens the screen of the first value
  const button = toast.getByRole('button', { name: /^Open / })
  const label = await button.innerText()
  log('button:', label)
  await button.click()
  await sleep(1500)
  if (label === 'Open Domain settings') {
    const dialog = page.getByRole('dialog').filter({ hasText: 'Domain settings' })
    check(await dialog.isVisible(), 'Domain settings opens')
    check(
      (await dialog.innerText()).includes('Pod could not read'),
      'Domain settings asks for the value again'
    )
  } else {
    check(await page.getByText('Back to app', { exact: true }).isVisible(), 'Settings opens')
  }
  await page.screenshot({ path: `${OUT}/start-notice-2-opened.png` })
  check(!(await toast.isVisible()), 'the button closes the notice')
  await page.keyboard.press('Escape')
  await leaveSettings(page)

  // 3. the next start shows nothing
  await reload(page)
  check(
    !(await page.locator('[data-sonner-toast]').filter({ hasText: TITLE }).isVisible()),
    'the notice does not come back'
  )
} finally {
  if (!wasShown) {
    rmSync(SHOWN_FILE, { force: true })
  }
  await browser.close()
}

if (failures.length) {
  console.error(`FAILED: ${failures.join('; ')}`)
  process.exit(1)
}
log('start-notice smoke passed')
