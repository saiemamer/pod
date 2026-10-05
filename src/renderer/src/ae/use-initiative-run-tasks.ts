import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { AeInitiativeStatus } from '../../../shared/ae/domain-types'

/** Shape of one row from `orchestration.taskList`; dispatched tasks also carry the worker handle. */
export type InitiativeRunTask = {
  id: string
  task_title: string | null
  display_name: string | null
  status: string
  spec: string
  assignee_handle?: string | null
  dispatch_id?: string | null
}

type TaskListResult = { runId: string; legacyReadOnly: boolean; tasks: InitiativeRunTask[] }

export type InitiativeRunTasks = {
  tasks: InitiativeRunTask[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function taskLabel(task: InitiativeRunTask): string {
  return task.display_name || task.task_title || task.id
}

// Why a poll: the runtime pushes no event when a task or its dispatch changes state.
const POLL_MS = 3000
const FINISHED_TASK_STATUSES = new Set(['completed', 'failed'])

/** A run is unfinished while the initiative is open and a task can still change, or more can come. */
export function initiativeRunIsActive(
  initiativeStatus: AeInitiativeStatus,
  tasks: readonly InitiativeRunTask[]
): boolean {
  if (initiativeStatus === 'done' || initiativeStatus === 'archived') {
    return false
  }
  return (
    initiativeStatus === 'running' ||
    tasks.length === 0 ||
    tasks.some((task) => !FINISHED_TASK_STATUSES.has(task.status))
  )
}

/** Pod: the tasks of an initiative's orchestration run, fetched on mount, on Refresh, and every few seconds while the run is unfinished. */
export function useInitiativeRunTasks(
  runId: string | undefined,
  initiativeStatus: AeInitiativeStatus,
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): InitiativeRunTasks {
  const [tasks, setTasks] = useState<InitiativeRunTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const latestRef = useRef(0)
  const environmentId = settings?.activeRuntimeEnvironmentId ?? null

  const fetchTasks = useCallback(
    (quiet: boolean) => {
      if (!runId) {
        return
      }
      const request = ++latestRef.current
      if (!quiet) {
        setLoading(true)
        setError(null)
      }
      callRuntimeRpc<TaskListResult>(
        getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId }),
        'orchestration.taskList',
        { run: runId }
      )
        .then((result) => {
          if (request === latestRef.current) {
            setTasks(result.tasks)
            setError(null)
          }
        })
        .catch((caught: unknown) => {
          if (request === latestRef.current) {
            setError(caught instanceof Error ? caught.message : String(caught))
          }
        })
        .finally(() => {
          if (request === latestRef.current) {
            setLoading(false)
          }
        })
    },
    [runId, environmentId]
  )

  useEffect(() => {
    fetchTasks(false)
  }, [fetchTasks, generation])

  const active = Boolean(runId) && initiativeRunIsActive(initiativeStatus, tasks)
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => fetchTasks(true), POLL_MS)
    return () => clearInterval(timer)
  }, [active, fetchTasks])

  const refresh = useCallback(() => setGeneration((current) => current + 1), [])
  return { tasks: runId ? tasks : [], loading, error, refresh }
}
