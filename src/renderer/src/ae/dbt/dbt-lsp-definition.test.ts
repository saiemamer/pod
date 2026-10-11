import { beforeEach, describe, expect, it, vi } from 'vitest'

const openFile = vi.fn()
const owner = {
  filePath: '/w/repo/models/orders.sql',
  relativePath: 'models/orders.sql',
  worktreeId: 'wt-1',
  mode: 'edit'
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ openFile, openFiles: [owner], activeGroupIdByWorktree: {} }) }
}))
vi.mock('@/lib/monaco-languages/register-jinja-sql', () => ({ JINJA_SQL_LANGUAGE_ID: 'jinja-sql' }))
vi.mock('@/store/slices/editor/focus/editor-focus-reveal', () => ({
  scheduleEditorLineReveal: vi.fn()
}))
vi.mock('@/store/slices/editor/file-ids/editor-file-ids', () => ({
  getOpenedEditFileIdAfterOpen: () => 'file-2'
}))

import { openPodDbtDefinitionTarget } from './dbt-lsp-definition'

describe('openPodDbtDefinitionTarget', () => {
  beforeEach(() => {
    openFile.mockClear()
  })

  it('opens a definition inside the worktree as a project tab', () => {
    expect(
      openPodDbtDefinitionTarget(owner.filePath, '/w/repo/dbt_packages/utils/macros/x.sql', null)
    ).toBe(true)
    expect(openFile).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'dbt_packages/utils/macros/x.sql' }),
      expect.anything()
    )
  })

  it('handles a definition outside the worktree by opening nothing', () => {
    expect(openPodDbtDefinitionTarget(owner.filePath, '/Users/me/.ssh/config', null)).toBe(true)
    expect(openFile).not.toHaveBeenCalled()
  })

  it('leaves a source no dbt tab owns to Monaco', () => {
    expect(openPodDbtDefinitionTarget('/elsewhere/a.sql', '/w/repo/x.sql', null)).toBe(false)
    expect(openFile).not.toHaveBeenCalled()
  })
})
