import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  DbtCompileResult,
  DbtContextSummary,
  DbtShowResult
} from '../../../../shared/ae/dbt-types'
import {
  podDbtErrorMessage,
  podDbtRunLabel,
  type PodDbtRunTarget
} from '@/ae/dbt/pod-dbt-run-target'

/**
 * Pod: results of dbt runs started from an editor, keyed by the open file's id so the
 * dock under that editor shows them. Kept out of OpenFile: every editor mode there is
 * special-cased in dozens of places, and this state only matters to the dock.
 */
export type PodDbtDockView = 'table' | 'compiled' | 'connection'

export type PodDbtResultState = {
  fileId: string
  filePath: string
  runId: number
  status: 'running' | 'done' | 'error'
  kind: 'show' | 'compile'
  label: string
  startedAt: number
  show?: DbtShowResult
  compile?: DbtCompileResult
  project?: DbtContextSummary
  error?: string
  view: PodDbtDockView
  collapsed: boolean
}

export type PodDbtRunArgs = {
  fileId: string
  filePath: string
  kind: 'show' | 'compile'
  target: PodDbtRunTarget
  limit?: number
}

export type AeDbtResultsSlice = {
  aeDbtResults: Record<string, PodDbtResultState>
  runAeDbt: (args: PodDbtRunArgs) => Promise<void>
  setAeDbtView: (fileId: string, view: PodDbtDockView) => void
  toggleAeDbtCollapsed: (fileId: string) => void
  closeAeDbtResults: (fileId: string) => void
  loadAeDbtProject: (fileId: string, filePath: string) => Promise<void>
}

function dbtApi(): Window['api']['ae']['dbt'] | null {
  return typeof window !== 'undefined' && window.api?.ae?.dbt ? window.api.ae.dbt : null
}

let nextRunId = 1

export const createAeDbtResultsSlice: StateCreator<AppState, [], [], AeDbtResultsSlice> = (
  set,
  get
) => {
  const patch = (fileId: string, update: Partial<PodDbtResultState>): void => {
    const current = get().aeDbtResults[fileId]
    if (!current) {
      return
    }
    set({ aeDbtResults: { ...get().aeDbtResults, [fileId]: { ...current, ...update } } })
  }
  return {
    aeDbtResults: {},
    runAeDbt: async ({ fileId, filePath, kind, target, limit }) => {
      const api = dbtApi()
      if (!api) {
        return
      }
      const runId = nextRunId
      nextRunId += 1
      const previous = get().aeDbtResults[fileId]
      set({
        aeDbtResults: {
          ...get().aeDbtResults,
          [fileId]: {
            ...previous,
            fileId,
            filePath,
            runId,
            status: 'running',
            kind,
            label: podDbtRunLabel(target),
            startedAt: Date.now(),
            error: undefined,
            view: kind === 'compile' ? 'compiled' : 'table',
            collapsed: false
          }
        }
      })
      // Why: only the newest run may write its answer; an older slow query must not overwrite it.
      const isCurrent = (): boolean => get().aeDbtResults[fileId]?.runId === runId
      try {
        if (kind === 'show') {
          const show = await api.show({ path: filePath, ...target, limit })
          if (isCurrent()) {
            patch(fileId, { status: 'done', show })
          }
        } else {
          const compile = await api.compile({ path: filePath, ...target })
          if (isCurrent()) {
            patch(fileId, { status: 'done', compile })
          }
        }
      } catch (error) {
        if (isCurrent()) {
          patch(fileId, { status: 'error', error: podDbtErrorMessage(error) })
        }
      }
    },
    setAeDbtView: (fileId, view) => patch(fileId, { view }),
    toggleAeDbtCollapsed: (fileId) => {
      const current = get().aeDbtResults[fileId]
      if (current) {
        patch(fileId, { collapsed: !current.collapsed })
      }
    },
    closeAeDbtResults: (fileId) => {
      const { [fileId]: _closed, ...rest } = get().aeDbtResults
      set({ aeDbtResults: rest })
    },
    loadAeDbtProject: async (fileId, filePath) => {
      const api = dbtApi()
      if (!api) {
        return
      }
      try {
        const project = await api.project({ path: filePath })
        patch(fileId, { project })
      } catch (error) {
        patch(fileId, { error: podDbtErrorMessage(error) })
      }
    }
  }
}
