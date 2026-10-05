// CI only: waits until a freshly started `pnpm dev` answers on the DevTools port with Pod's API,
// then gives its new profile the completed-onboarding state upstream's E2E fixture uses, so
// Orca's first-run overlay and feature tips do not cover what the click-through scripts click.
// Run it once after starting the build, before ui-smoke.mjs. One screenshot: ci-ready.
import { createRequire } from 'node:module'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const { build } = require('esbuild')

const PORT = process.env.POD_SMOKE_CDP_PORT ?? '9333'
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const deadline = Date.now() + Number(process.env.POD_SMOKE_READY_MS ?? 300000)
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Why bundle: the profile helper is TypeScript importing src/shared; esbuild is already a dependency.
const bundled = await build({
  entryPoints: ['tests/e2e/helpers/e2e-completed-onboarding-profile.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent'
})
const { getE2ECompletedOnboardingProfile } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
)
const profile = getE2ECompletedOnboardingProfile()

async function connect() {
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`nothing answered on port ${PORT}: ${error.message}`)
      }
      await sleep(3000)
    }
  }
}

async function apiPage(browser) {
  for (;;) {
    for (const p of browser.contexts().flatMap((c) => c.pages())) {
      const ready = await p
        .evaluate(
          () =>
            typeof window.api?.onboarding?.update === 'function' &&
            typeof window.api?.ae?.domains?.list === 'function'
        )
        .catch(() => false)
      if (ready) {
        return p
      }
    }
    if (Date.now() > deadline) {
      throw new Error('no page with window.api.onboarding and window.api.ae')
    }
    await sleep(2000)
  }
}

const browser = await connect()
log('connected on port', PORT)
let page = await apiPage(browser)
log('app page:', page.url())
// Why wait: the renderer classifies a new profile for tours once its state loads, and would write over ours.
await sleep(3000)
const before = await page.evaluate(() => window.api.onboarding.get())
log('onboarding before:', JSON.stringify({ closedAt: before.closedAt, outcome: before.outcome }))
await page.evaluate(async (p) => {
  await window.api.onboarding.update(p.onboarding)
  await window.api.ui.set(p.ui)
}, profile)
await page.reload()
page = await apiPage(browser)
await sleep(3000)
const after = await page.evaluate(() => window.api.onboarding.get())
log('onboarding after:', JSON.stringify({ closedAt: after.closedAt, outcome: after.outcome }))
if (after.closedAt === null) {
  throw new Error('onboarding is still open after the update')
}
// A tip that opens anyway is closed the way each script's first Escape would.
const dialogs = page.getByRole('dialog').filter({ visible: true })
if (await dialogs.count()) {
  log(
    'open dialog after reload:',
    (await dialogs.first().innerText()).replace(/\n+/g, ' | ').slice(0, 200)
  )
  await page.keyboard.press('Escape')
  await sleep(500)
}
await page.screenshot({ path: `${OUT}/ci-ready.png` })
await browser.close()
log('ready')
