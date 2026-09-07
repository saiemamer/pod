import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  DbtCompileResult,
  DbtContextSummary,
  DbtShowResult
} from '../../../../shared/ae/dbt-types'
import type { DbtLspStatus } from '../../../../shared/ae/dbt-lsp-types'
import {
  dbtModelNameFromPath,
  podDbtErrorMessage,
  podDbtRunLabel,
  type PodDbtRunTarget
} from '@/ae/dbt/pod-dbt-run-target'

/**
 * Pod: results of dbt runs started from an editor, keyed by the open file's id so the
 * dock under that editor shows them. Kept out of OpenFile: every editor mode there is
 * special-cased in dozens of places, and this state only matters to the dock.
 */
export type PodDbtDockView = 'table' | 'compiled' | 'connection' | 'lineage'

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
  /** Opens the dock on a view without running anything (Lineage, Connection). */
  openAeDbtView: (fileId: string, filePath: string, view: PodDbtDockView) => void
  toggleAeDbtCollapsed: (fileId: string) => void
  closeAeDbtResults: (fileId: string) => void
  loadAeDbtProject: (fileId: string, filePath: string) => Promise<void>
  /** Dock height in pixels, shared by every dock and kept across restarts. */
  aeDbtDockHeight: number
  setAeDbtDockHeight: (height: number) => void
  /** Language server status per project directory. */
  aeDbtLsp: Record<string, DbtLspStatus>
  setAeDbtLspStatus: (status: DbtLspStatus) => void
}

export const POD_DBT_DOCK_HEIGHT_DEFAULT = 288
export const POD_DBT_DOCK_HEIGHT_MIN = 120
const DOCK_HEIGHT_STORAGE_KEY = 'pod.dbt.dockHeight'

export function clampPodDbtDockHeight(height: number, viewportHeight: number): number {
  const max = Math.max(POD_DBT_DOCK_HEIGHT_MIN, Math.floor(viewportHeight * 0.8))
  return Math.min(max, Math.max(POD_DBT_DOCK_HEIGHT_MIN, Math.round(height)))
}

function readStoredDockHeight(): number {
  try {
    const raw = globalThis.localStorage?.getItem(DOCK_HEIGHT_STORAGE_KEY)
    const parsed = raw ? Number(raw) : Number.NaN
    return Number.isFinite(parsed) && parsed >= POD_DBT_DOCK_HEIGHT_MIN
      ? parsed
      : POD_DBT_DOCK_HEIGHT_DEFAULT
  } catch {
    return POD_DBT_DOCK_HEIGHT_DEFAULT
  }
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
    set({
      aeDbtResults: {
        ...get().aeDbtResults,
        [fileId]: { ...current, ...update }
      }
    })
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
    openAeDbtView: (fileId, filePath, view) => {
      const current = get().aeDbtResults[fileId]
      if (current) {
        patch(fileId, { view, collapsed: false })
        return
      }
      set({
        aeDbtResults: {
          ...get().aeDbtResults,
          [fileId]: {
            fileId,
            filePath,
            runId: 0,
            status: 'done',
            kind: 'show',
            label: podDbtRunLabel({ model: dbtModelNameFromPath(filePath) }),
            startedAt: Date.now(),
            view,
            collapsed: false
          }
        }
      })
    },
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
    aeDbtDockHeight: readStoredDockHeight(),
    setAeDbtDockHeight: (height) => {
      set({ aeDbtDockHeight: height })
      try {
        globalThis.localStorage?.setItem(DOCK_HEIGHT_STORAGE_KEY, String(height))
      } catch {
        // Why: storage can be unavailable in tests and private contexts; the height still applies.
      }
    },
    aeDbtLsp: {},
    setAeDbtLspStatus: (status) => {
      if (status.projectDir) {
        set({ aeDbtLsp: { ...get().aeDbtLsp, [status.projectDir]: status } })
      }
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
