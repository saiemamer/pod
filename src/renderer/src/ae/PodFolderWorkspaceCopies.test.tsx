// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { Worktree } from '../../../shared/worktree/types'
import { folderWorkspaceKey, worktreeWorkspaceKey } from '../../../shared/workspace-scope'
import {
  makeFolderWorkspace,
  makeWorkspaceLineage,
  makeWorktree
} from '@/store/slices/worktrees-slice-test-fixtures'
import { PodFolderWorkspaceCopies } from './PodFolderWorkspaceCopies'

const activateAndRevealWorktree = vi.hoisted(() => vi.fn())
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree }))

const initialAppState = useAppStore.getInitialState()
let root: Root | null = null
let container: HTMLDivElement | null = null

const COPY_ID = 'repo-dbt::/workspaces/dbt-demo/smoke-part'

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return makeWorktree({
    id: COPY_ID,
    repoId: 'repo-dbt',
    instanceId: 'copy-instance',
    displayName: 'smoke-part',
    ...overrides
  })
}

function seed(copy: Worktree, parentFolderId = 'initiative-1'): void {
  const childKey = worktreeWorkspaceKey(COPY_ID)
  useAppStore.setState({
    folderWorkspaces: [makeFolderWorkspace({ id: 'initiative-1' })],
    worktreesByRepo: { 'repo-dbt': [copy] },
    workspaceLineageByChildKey: {
      [childKey]: makeWorkspaceLineage({
        childWorkspaceKey: childKey,
        childInstanceId: 'copy-instance',
        parentWorkspaceKey: folderWorkspaceKey(parentFolderId)
      })
    }
  })
}

async function render(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PodFolderWorkspaceCopies folderWorkspaceId="initiative-1" indent={0} />)
  })
  return container
}

beforeEach(() => {
  useAppStore.setState(initialAppState, true)
  Object.assign(window, { api: { ui: { set: vi.fn(async () => undefined) } } })
  activateAndRevealWorktree.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  Reflect.deleteProperty(window, 'api')
  useAppStore.setState(initialAppState, true)
})

describe('PodFolderWorkspaceCopies', () => {
  it("lists a worktree made with --parent-worktree under its initiative's row and opens it", async () => {
    seed(worktree())
    const view = await render()

    const copy = view.querySelector<HTMLButtonElement>(`[data-pod-folder-copy-id="${COPY_ID}"]`)
    expect(copy?.textContent).toContain('smoke-part')
    act(() => copy?.click())
    expect(activateAndRevealWorktree).toHaveBeenCalledWith(COPY_ID)
  })

  it('hides the copies when the initiative list is collapsed', async () => {
    seed(worktree())
    const view = await render()

    act(() => view.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click())
    expect(view.querySelector(`[data-pod-folder-copy-id="${COPY_ID}"]`)).toBeNull()
    expect(view.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows nothing for another folder workspace or an archived copy', async () => {
    seed(worktree(), 'other')
    expect((await render()).textContent).toBe('')
    act(() => root?.unmount())

    seed(worktree({ isArchived: true }))
    expect((await render()).textContent).toBe('')
  })

  it("renders nothing when the store lacks the values it reads, as in Orca's sidebar row tests", async () => {
    const partialState = { ...initialAppState }
    for (const key of [
      'folderWorkspaces',
      'workspaceLineageByChildKey',
      'worktreeLineageById',
      'worktreesByRepo',
      'collapsedGroups'
    ]) {
      Reflect.deleteProperty(partialState, key)
    }
    useAppStore.setState(partialState, true)

    expect((await render()).textContent).toBe('')
  })
})
