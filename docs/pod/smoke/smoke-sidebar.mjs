// Finds a project's primary worktree row in the sidebar by its worktree id, so a smoke never
// depends on the order of projects or on whether a project row is collapsed.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function primaryWorktreeRow(page, repoPath) {
  const repo = await page.evaluate(
    async (path) => (await window.api.repos.list()).find((entry) => entry.path === path),
    repoPath
  )
  if (!repo) {
    throw new Error(`no project at ${repoPath}; run ui-smoke.mjs first`)
  }
  const sidebar = page.locator('[data-worktree-sidebar]').first()
  const row = sidebar.locator(`[data-worktree-id="${repo.id}::${repo.path}"]`).first()
  if ((await row.count()) === 0) {
    // Collapsed project: one click on its header row expands it.
    await sidebar
      .getByText(repo.displayName ?? repoPath.split('/').pop(), { exact: true })
      .first()
      .click()
    await sleep(800)
  }
  await row.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
    throw new Error(`no worktree row for ${repoPath} in the sidebar`)
  })
  return row
}

// A row of the right sidebar's Explorer. Visible rows only: other workspaces keep their trees
// (and tab bars, under the same file names) mounted but hidden.
export function explorerRow(page, name) {
  return page
    .locator('[data-file-explorer-row]')
    .filter({ visible: true })
    .getByText(name, { exact: true })
    .first()
}

export async function openExplorerFile(page, segments) {
  const explorer = page.locator('[aria-label^="Explorer"]')
  if (await explorer.count()) {
    await explorer.first().click()
    await sleep(500)
  }
  // Why check first: the Explorer remembers expansion, so a click on an open folder closes it.
  for (let i = 0; i < segments.length; i += 1) {
    const node = explorerRow(page, segments[i])
    await node.waitFor({ state: 'visible' })
    const child = segments[i + 1] ? explorerRow(page, segments[i + 1]) : null
    if (!child || (await child.count()) === 0) {
      await node.click()
      await sleep(500)
    }
  }
}

// Settings is a page, not a dialog: Escape leaves it open, and a restarted build reopens it.
export async function leaveSettings(page) {
  const back = page.getByText('Back to app', { exact: true })
  if (await back.isVisible().catch(() => false)) {
    await back.click()
    await sleep(500)
  }
}
