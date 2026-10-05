// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInitiativeRunTasks, type InitiativeRunTask } from './use-initiative-run-tasks'

const mocks = vi.hoisted(() => ({ callRuntimeRpc: vi.fn() }))

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))
vi.mock('@/runtime/runtime-client-target', () => ({ getActiveRuntimeTarget: () => ({}) }))

let taskStatuses: string[] = []
let workers: unknown = { workers: [] }

function task(status: string): InitiativeRunTask {
  return {
    id: 'task_1',
    task_title: 'stg_orders lineage report',
    display_name: null,
    status,
    spec: ''
  }
}

function taskListCalls(): number {
  return mocks.callRuntimeRpc.mock.calls.filter(([, method]) => method === 'orchestration.taskList')
    .length
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  taskStatuses = []
  workers = { workers: [] }
  mocks.callRuntimeRpc.mockReset()
  mocks.callRuntimeRpc.mockImplementation(async (_target: unknown, method: string) => {
    if (method === 'orchestration.workerList') {
      if (workers instanceof Error) {
        throw workers
      }
      return workers
    }
    const status = taskStatuses.length > 1 ? taskStatuses.shift() : taskStatuses[0]
    return { runId: 'run_1', legacyReadOnly: false, tasks: [task(status ?? 'ready')] }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useInitiativeRunTasks', () => {
  it("shows a task's new status within a few seconds, without Refresh", async () => {
    taskStatuses = ['dispatched', 'dispatched', 'completed']
    const { result } = renderHook(() => useInitiativeRunTasks('run_1', 'running', null))
    await flush()
    expect(result.current.tasks[0].status).toBe('dispatched')

    await flush(3000)
    await flush(3000)
    expect(result.current.tasks[0].status).toBe('completed')
    expect(result.current.loading).toBe(false)
  })

  it('stops asking once the initiative is done', async () => {
    taskStatuses = ['completed']
    renderHook(() => useInitiativeRunTasks('run_1', 'done', null))
    await flush()
    await flush(10_000)
    expect(taskListCalls()).toBe(1)
  })

  it('stops asking in review once every task has finished', async () => {
    taskStatuses = ['completed']
    renderHook(() => useInitiativeRunTasks('run_1', 'review', null))
    await flush()
    await flush(10_000)
    expect(taskListCalls()).toBe(1)
  })

  it("names the worktree of the task's latest worker, after it finished too", async () => {
    taskStatuses = ['completed']
    workers = {
      workers: [
        {
          taskId: 'task_1',
          resource: { worktreeId: 'repo-dbt::/copies/real-agent-check-stg-orders' },
          projection: { workspace: { id: 'repo-dbt::/copies/real-agent-check-stg-orders' } }
        },
        {
          taskId: 'task_1',
          resource: null,
          projection: { workspace: { id: 'repo-dbt::/copies/first-try' } }
        },
        { taskId: 'task_2', resource: null, projection: { workspace: null } }
      ]
    }
    const { result } = renderHook(() => useInitiativeRunTasks('run_1', 'review', null))
    await flush()
    expect(result.current.tasks[0].worker_worktree_id).toBe(
      'repo-dbt::/copies/real-agent-check-stg-orders'
    )
  })

  it('still lists the tasks when the host cannot list workers', async () => {
    taskStatuses = ['dispatched']
    workers = new Error('method_not_found')
    const { result } = renderHook(() => useInitiativeRunTasks('run_1', 'review', null))
    await flush()
    expect(result.current.error).toBeNull()
    expect(result.current.tasks[0]).toMatchObject({
      status: 'dispatched',
      worker_worktree_id: null
    })
  })
})
