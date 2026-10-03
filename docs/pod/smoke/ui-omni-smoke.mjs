// Phase 4 smoke: the Omni tab of the right sidebar on the pod-smoke omni-demo repo,
// against the stand-in omni (docs/pod/smoke/omni-stub.sh, never the network). Chooses
// the model from a two-page list (saved as OMNI_MODEL_ID in the domain), sees no branch,
// creates it, reads the branch's topics, validates, opens a topic, and, when
// out/cli/index.js exists, runs `orca omni branch | validate | commit --json` from the
// repo. Then it clears the model under the open panel and checks the picker's notes. Needs `pnpm dev` with
// REMOTE_DEBUGGING_PORT=9333 (see README.md). Screenshots go to POD_SMOKE_OUT.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const OMNI_STUB = join(process.cwd(), 'docs/pod/smoke/omni-stub.sh')
const MODEL_ID = '11111111-1111-4111-8111-111111111111'
const STATE = mkdtempSync(join(tmpdir(), 'pod-omni-smoke-'))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = (ok, message) => {
  if (!ok) {
    throw new Error(message)
  }
  log('ok:', message)
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
let page = null
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  if (
    await p.evaluate(() => typeof window.api?.ae?.omni?.branch === 'function').catch(() => false)
  ) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae.omni (is this build older than the Omni panel?)')
}
page.setDefaultTimeout(20000)
await page.keyboard.press('Escape')

// 1. settings and domain: the stand-in omni, a fake key, a fresh stub state, no model yet
const settings = await page.evaluate(() => window.api.settings.get())
const previousOverrides = settings.toolCmdOverrides ?? {}
await page.evaluate((overrides) => window.api.settings.set({ toolCmdOverrides: overrides }), {
  ...previousOverrides,
  omni: OMNI_STUB
})
let group = (await page.evaluate(() => window.api.projectGroups.list())).find(
  (g) => g.name === 'pod-smoke'
)
if (!group) {
  await page.evaluate(
    (parent) =>
      window.api.projectGroups.importNested({
        parentPath: parent,
        groupName: 'pod-smoke',
        projectPaths: [`${parent}/dbt-demo`, `${parent}/omni-demo`],
        mode: 'group'
      }),
    PARENT
  )
  group = (await page.evaluate(() => window.api.projectGroups.list())).find(
    (g) => g.name === 'pod-smoke'
  )
}
const domains = await page.evaluate(() => window.api.ae.domains.list())
const existing = domains.find((d) => d.id === group.id)
const previousEnv = existing?.env ?? {}
const { OMNI_MODEL_ID: _dropped, ...envWithoutModel } = previousEnv
const repos = existing?.repos?.length
  ? existing.repos
  : await page.evaluate((groupId) => window.api.ae.domains.detectRoles({ groupId }), group.id)
await page.evaluate((input) => window.api.ae.domains.save(input), {
  id: group.id,
  repos,
  env: { ...envWithoutModel, OMNI_API_KEY: 'smoke-not-a-real-key', POD_OMNI_STUB_STATE: STATE }
})

const restore = async () => {
  await page.evaluate(
    (overrides) => window.api.settings.set({ toolCmdOverrides: overrides }),
    previousOverrides
  )
  await page.evaluate((input) => window.api.ae.domains.save(input), {
    id: group.id,
    env: previousEnv
  })
}

try {
  // 2. activate omni-demo's primary worktree: the first `master` row below its project row
  const rowY = async (locator) => (await locator.boundingBox())?.y ?? null
  const omniProject = page.getByText('omni-demo', { exact: true }).first()
  const findRow = async () => {
    const top = await rowY(omniProject)
    const rows = page.getByText('master', { exact: true })
    let best = null
    for (let i = 0; i < (await rows.count()); i += 1) {
      const y = await rowY(rows.nth(i))
      if (top !== null && y !== null && y > top && (!best || y < best.y)) {
        best = { row: rows.nth(i), y }
      }
    }
    return best?.row ?? null
  }
  let row = await findRow()
  if (!row) {
    await omniProject.click()
    await sleep(800)
    row = await findRow()
  }
  check(row !== null, 'omni-demo has a master worktree row')
  await row.click()
  await sleep(1200)

  // 3. the Omni tab, then the model picker (no OMNI_MODEL_ID yet)
  const tab = page.locator('[aria-label^="Omni"]').first()
  check((await tab.count()) > 0, 'the right sidebar has an Omni tab')
  await tab.click()
  const panel = page.locator('[data-testid="pod-omni-panel"]')
  await panel.waitFor({ state: 'visible' })
  const picker = panel.locator('[data-testid="pod-omni-model-picker"]')
  await picker.getByText('mex', { exact: true }).waitFor({ state: 'visible' })
  check(
    (await picker.getByText('bigquery schema').count()) === 0,
    'the picker lists shared models only'
  )
  check(
    await picker.getByText('mex sandbox', { exact: true }).isVisible(),
    "the picker follows the model list's second page"
  )
  await page.screenshot({ path: `${OUT}/omni-1-picker.png` })
  await picker.getByRole('button', { name: 'Use' }).first().click()

  // 4. the branch named after the git branch is not on Omni yet
  const status = panel.locator('[data-testid="pod-omni-branch-status"]')
  await status.getByText('not on Omni yet').waitFor({ state: 'visible' })
  const saved = (await page.evaluate(() => window.api.ae.domains.list())).find(
    (d) => d.id === group.id
  )
  check(saved?.env?.OMNI_MODEL_ID === MODEL_ID, 'Use saved OMNI_MODEL_ID into the domain env')
  check(await panel.getByText('someone-else').isVisible(), "another worker's branch is listed")
  const topics = panel.locator('[data-testid="pod-omni-topic"]')
  await topics.first().waitFor({ state: 'visible' })
  check((await topics.count()) === 3, `shared model shows 3 topics (got ${await topics.count()})`)
  await page.screenshot({ path: `${OUT}/omni-2-no-branch.png` })

  // 5. create the branch; topics re-read on the branch, which has one more
  await panel.getByRole('button', { name: 'Create branch' }).click()
  await status.getByText('on Omni', { exact: true }).waitFor({ state: 'visible' })
  await panel.getByText('Ticket channels').waitFor({ state: 'visible' })
  check((await topics.count()) === 4, 'branch topics include the branch-only topic')
  await page.screenshot({ path: `${OUT}/omni-3-branch-created.png` })

  // 6. validate the branch
  await panel.getByRole('button', { name: 'Validate' }).click()
  const validation = panel.locator('[data-testid="pod-omni-validation"]')
  await validation.waitFor({ state: 'visible' })
  const validationText = await validation.innerText()
  check(
    validationText.includes('Invalid branch: 1 error(s), 1 warning(s)'),
    `validation summary (${validationText.split('\n')[0]})`
  )
  check(validationText.includes('tickets.count_by_channel'), 'the error names its view and field')
  await page.screenshot({ path: `${OUT}/omni-4-validate.png` })

  // 7. open a topic: views with their fields and the join
  // Why exact: a substring match on "Tickets" also takes "Legacy tickets", which sorts first.
  const ticketsRow = topics.filter({ has: page.getByText('Tickets', { exact: true }) })
  check((await ticketsRow.count()) === 1, 'exactly one Tickets topic row')
  await ticketsRow.click()
  check(
    (await ticketsRow.getAttribute('aria-expanded')) === 'true',
    'the Tickets row is the open one'
  )
  const detail = panel.locator('[data-testid="pod-omni-topic-detail"]')
  await detail.waitFor({ state: 'visible' })
  const detailText = await detail.innerText()
  check(detailText.includes('dimensions 3 · measures 2'), 'topic detail counts the fields')
  check(detailText.includes('tickets → customers'), 'topic detail shows the join')
  await page.screenshot({ path: `${OUT}/omni-5-topic.png` })

  // 8. the CLI, when built (`pnpm build:cli`): same branch, validation, then a commit
  const orca = join(process.cwd(), 'out/bin/orca')
  // Why the bundle: `pnpm dev` writes the out/bin/orca wrapper whether or not the CLI is built.
  if (existsSync(join(process.cwd(), 'out/cli/index.js'))) {
    const cli = (args) =>
      JSON.parse(execFileSync(orca, ['omni', ...args, '--json'], { cwd: `${PARENT}/omni-demo` }))
    const branch = cli(['branch']).result
    check(branch.branch?.name === 'master' && !branch.created, 'orca omni branch finds it')
    check(cli(['validate']).result.errors === 1, 'orca omni validate reports the error')
    const commit = cli(['commit', '--message', 'Smoke commit']).result
    check(commit.prUrl?.startsWith('https://'), `orca omni commit returns ${commit.prUrl}`)
  } else {
    log('skip: out/cli/index.js missing; run pnpm build:cli for the CLI steps')
  }

  // 9. the panel follows the domain: clearing OMNI_MODEL_ID elsewhere brings the picker back
  const current = (await page.evaluate(() => window.api.ae.domains.list())).find(
    (d) => d.id === group.id
  )
  const { OMNI_MODEL_ID: _cleared, ...envCleared } = current.env
  await page.evaluate((input) => window.api.ae.domains.save(input), {
    id: group.id,
    env: { ...envCleared, POD_OMNI_STUB_MODELS: 'endless-schema' }
  })
  await picker.waitFor({ state: 'visible' })
  check(true, 'clearing OMNI_MODEL_ID in the domain reloads the open panel to the picker')
  await picker.getByText('No shared models found.', { exact: false }).waitFor({ state: 'visible' })
  check(
    await picker.getByText('Showing the first 1,000 models.', { exact: false }).isVisible(),
    'with no shared model and pages that never end, the picker says so and stops at 1,000'
  )
  await page.screenshot({ path: `${OUT}/omni-6-no-shared-models.png` })

  // 10. every call carried a token: the domain's OMNI_API_KEY reached the CLI as OMNI_API_TOKEN
  const calls = readFileSync(join(STATE, 'calls.log'), 'utf8').trim().split('\n')
  check(
    calls.length > 0 && calls.every((line) => line.startsWith('token=yes')),
    `${calls.length} omni calls, all with a token`
  )
} finally {
  await restore()
}
log('done; screenshots in', OUT)
await browser.close()
