import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import type { GlobalSettings } from '../../../shared/global-settings-types'

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

/** Pod: the tasks of an initiative's orchestration run, fetched on mount and on Refresh. */
export function useInitiativeRunTasks(
  runId: string | undefined,
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): InitiativeRunTasks {
  const [tasks, setTasks] = useState<InitiativeRunTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const latestRef = useRef(0)
  const environmentId = settings?.activeRuntimeEnvironmentId ?? null

  useEffect(() => {
    if (!runId) {
      return
    }
    const request = ++latestRef.current
    setLoading(true)
    setError(null)
    callRuntimeRpc<TaskListResult>(
      getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId }),
      'orchestration.taskList',
      {
        run: runId
      }
    )
      .then((result) => {
        if (request === latestRef.current) {
          setTasks(result.tasks)
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
  }, [runId, environmentId, generation])

  const refresh = useCallback(() => setGeneration((current) => current + 1), [])
  return { tasks: runId ? tasks : [], loading, error, refresh }
}
