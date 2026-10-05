// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInitiativeRunTasks, type InitiativeRunTask } from './use-initiative-run-tasks'

const mocks = vi.hoisted(() => ({ callRuntimeRpc: vi.fn() }))

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))
vi.mock('@/runtime/runtime-client-target', () => ({ getActiveRuntimeTarget: () => ({}) }))

function task(status: string): InitiativeRunTask {
  return {
    id: 'task_1',
    task_title: 'stg_orders lineage report',
    display_name: null,
    status,
    spec: ''
  }
}

function answer(status: string): void {
  mocks.callRuntimeRpc.mockResolvedValueOnce({
    runId: 'run_1',
    legacyReadOnly: false,
    tasks: [task(status)]
  })
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.callRuntimeRpc.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useInitiativeRunTasks', () => {
  it("shows a task's new status within a few seconds, without Refresh", async () => {
    answer('dispatched')
    answer('dispatched')
    answer('completed')
    const { result } = renderHook(() => useInitiativeRunTasks('run_1', 'running', null))
    await flush()
    expect(result.current.tasks[0].status).toBe('dispatched')

    await flush(3000)
    await flush(3000)
    expect(result.current.tasks[0].status).toBe('completed')
    expect(result.current.loading).toBe(false)
  })

  it('stops asking once the initiative is done', async () => {
    answer('completed')
    renderHook(() => useInitiativeRunTasks('run_1', 'done', null))
    await flush()
    await flush(10_000)
    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(1)
  })

  it('stops asking in review once every task has finished', async () => {
    answer('completed')
    renderHook(() => useInitiativeRunTasks('run_1', 'review', null))
    await flush()
    await flush(10_000)
    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(1)
  })
})
