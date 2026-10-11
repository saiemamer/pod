import { beforeEach, describe, expect, it, vi } from 'vitest'

const openFile = vi.fn()

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ openFile, openFiles: [], activeGroupIdByWorktree: {} }) }
}))
vi.mock('@/store/slices/editor/file-ids/editor-file-ids', () => ({
  getOpenedEditFileIdAfterOpen: () => 'file-1'
}))

import { openPodDbtFile } from './pod-dbt-open-file'

describe('openPodDbtFile', () => {
  beforeEach(() => {
    openFile.mockClear()
  })

  it('opens a model inside the worktree as a project tab', () => {
    expect(
      openPodDbtFile({
        worktreeId: 'wt-1',
        worktreePath: '/w/repo',
        filePath: '/w/repo/models/orders.sql'
      })
    ).toBe('file-1')
    expect(openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/w/repo/models/orders.sql',
        relativePath: 'models/orders.sql'
      }),
      expect.anything()
    )
  })

  it('opens nothing for a model path that resolves outside the worktree', () => {
    expect(
      openPodDbtFile({
        worktreeId: 'wt-1',
        worktreePath: '/w/repo',
        filePath: '/w/repo/models/../../etc/passwd'
      })
    ).toBeNull()
    expect(openFile).not.toHaveBeenCalled()
  })
})
