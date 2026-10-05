import { describe, expect, it } from 'vitest'
import { agentRowDisplayDotState } from './agent-row-dot-state'

describe('agentRowDisplayDotState', () => {
  it('shows a session that has not run a turn yet as idle, not done', () => {
    // Why: Claude's SessionStart lands as a session-boundary `done`, which a main agent with a
    // drafted, unsent prompt keeps until the person presses Enter.
    expect(
      agentRowDisplayDotState({ state: 'done', entry: { state: 'done', sessionBoundary: true } })
    ).toBe('idle')
  })

  it('still shows a finished turn as done', () => {
    expect(agentRowDisplayDotState({ state: 'done', entry: { state: 'done' } })).toBe('done')
  })
})
