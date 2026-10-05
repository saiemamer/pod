import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { makePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import { resolveWorktreeStatus } from './worktree-status'
import {
  resetTerminalTabActivityFlagsCacheForTest,
  resolveTerminalTabActivityStatus
} from '../components/tab-bar/terminal-tab-activity-status'
import { selectWorktreeAgentActivitySummary } from '../components/sidebar/worktree-agent-activity-summary'

const NOW = 10_000
const TAB_ID = 'tab-1'
const WORKTREE_ID = 'repo::/initiative'
const PANE_KEY = makePaneKey(TAB_ID, '11111111-1111-4111-8111-111111111111')
const LIVE_PTY = { [TAB_ID]: ['pty-1'] }
const TAB: TerminalTab = {
  id: TAB_ID,
  ptyId: 'pty-1',
  worktreeId: WORKTREE_ID,
  title: 'Claude',
  customTitle: null,
  color: null,
  sortOrder: 0,
  createdAt: 0
}

function done(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey: PANE_KEY,
    state: 'done',
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    agentType: 'claude',
    worktreeId: WORKTREE_ID,
    ...overrides
  }
}

function tabStatus(entry: AgentStatusEntry): string {
  return resolveTerminalTabActivityStatus({
    tab: TAB,
    agentStatusByPaneKey: { [PANE_KEY]: entry },
    ptyIdsByTabId: LIVE_PTY
  })
}

function cardStatus(entry: AgentStatusEntry): string {
  const summary = selectWorktreeAgentActivitySummary(
    {
      tabsByWorktree: { [WORKTREE_ID]: [TAB] },
      agentStatusEpoch: 0,
      agentStatusByPaneKey: { [PANE_KEY]: entry },
      migrationUnsupportedByPtyId: {},
      runtimeAgentOrchestrationByPaneKey: {},
      retainedAgentsByPaneKey: {}
    },
    WORKTREE_ID
  )
  return resolveWorktreeStatus({
    tabs: [TAB],
    browserTabs: [],
    ptyIdsByTabId: LIVE_PTY,
    ...summary
  })
}

beforeEach(() => {
  resetTerminalTabActivityFlagsCacheForTest()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  resetTerminalTabActivityFlagsCacheForTest()
})

// Pod: Claude's SessionStart lands as a `done` marked `sessionBoundary`, so a main agent whose
// drafted prompt was never sent showed a green check on its tab and its worktree card.
describe('a session that has not run a turn yet', () => {
  it('shows no finished mark on its tab or its worktree card', () => {
    const fresh = done({ sessionBoundary: true })
    expect(tabStatus(fresh)).toBe('active')
    expect(cardStatus(fresh)).toBe('active')
  })

  it('still shows a finished turn as done', () => {
    expect(tabStatus(done())).toBe('done')
    expect(cardStatus(done())).toBe('done')
  })

  it('still lets a stop or a failure win', () => {
    const stopped = done({ sessionBoundary: true, interrupted: true })
    expect(tabStatus(stopped)).toBe('interrupted')
    expect(cardStatus(stopped)).toBe('interrupted')

    const failed = done({
      sessionBoundary: true,
      mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: NOW }
    })
    expect(tabStatus(failed)).toBe('failed')
    expect(cardStatus(failed)).toBe('failed')
  })
})
