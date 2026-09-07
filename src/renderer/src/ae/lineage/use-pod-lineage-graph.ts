import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DbtColumnLineageResult,
  DbtGraphResult,
  DbtLineageEngineStatus
} from '../../../../shared/ae/dbt-graph-types'
import { podDbtErrorMessage } from '@/ae/dbt/pod-dbt-run-target'
import {
  EMPTY_COLLAPSE,
  lineageHighlightFrom,
  mergeLineageGraphs,
  type LineageCollapse,
  type LineageHighlight
} from './lineage-canvas-state'

/**
 * Pod: the lineage view's state. The graph comes from main per (file, depths); expanding
 * a node's handle fetches one more level around that node and merges it in; a column
 * click asks for column lineage and turns it into a highlight.
 */
const COLUMNS_STORAGE_KEY = 'pod.dbt.lineageColumns'

function readStoredColumns(): boolean {
  try {
    return globalThis.localStorage?.getItem(COLUMNS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export type PodLineageGraphState = {
  graph: DbtGraphResult | null
  loading: boolean
  error: string | null
  upstreamDepth: number | null
  downstreamDepth: number | null
  collapse: LineageCollapse
  highlight: LineageHighlight | null
  columnResult: DbtColumnLineageResult | null
  columnError: string | null
  focusColumn: string | null
  showColumns: boolean
  showTree: boolean
  selectedNodeId: string | null
  engine: DbtLineageEngineStatus | null
  arrangeKey: number
  reload: () => void
  setDepth: (side: 'up' | 'down', delta: number) => void
  toggleColumns: () => void
  toggleTree: () => void
  arrange: () => void
  toggleCollapse: (nodeId: string, side: 'up' | 'down') => void
  expand: (nodeId: string, side: 'up' | 'down') => Promise<void>
  clickColumn: (nodeId: string, column: string) => Promise<void>
  select: (nodeId: string | null) => void
  parseProject: () => Promise<void>
}

export function usePodLineageGraph(filePath: string): PodLineageGraphState {
  const [graph, setGraph] = useState<DbtGraphResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [upstreamDepth, setUpstreamDepth] = useState<number | null>(null)
  const [downstreamDepth, setDownstreamDepth] = useState<number | null>(null)
  const [collapse, setCollapse] = useState<LineageCollapse>(EMPTY_COLLAPSE)
  const [columnResult, setColumnResult] = useState<DbtColumnLineageResult | null>(null)
  const [columnError, setColumnError] = useState<string | null>(null)
  const [showColumns, setShowColumns] = useState(readStoredColumns)
  const [showTree, setShowTree] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [engine, setEngine] = useState<DbtLineageEngineStatus | null>(null)
  const [arrangeKey, setArrangeKey] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const requestId = useRef(0)

  useEffect(() => {
    const api = window.api?.ae?.dbt
    if (!api) {
      return
    }
    const id = requestId.current + 1
    requestId.current = id
    setLoading(true)
    setError(null)
    void api
      .graph({
        path: filePath,
        ...(upstreamDepth !== null ? { upstreamDepth } : {}),
        ...(downstreamDepth !== null ? { downstreamDepth } : {})
      })
      .then((result) => {
        if (requestId.current !== id) {
          return
        }
        setGraph(result)
        setUpstreamDepth(result.upstreamDepth)
        setDownstreamDepth(result.downstreamDepth)
        setCollapse(EMPTY_COLLAPSE)
        setColumnResult(null)
        setColumnError(null)
      })
      .catch((cause: unknown) => {
        if (requestId.current === id) {
          setError(podDbtErrorMessage(cause))
        }
      })
      .finally(() => {
        if (requestId.current === id) {
          setLoading(false)
        }
      })
  }, [filePath, upstreamDepth, downstreamDepth, reloadKey])

  useEffect(() => {
    const api = window.api?.ae?.dbt
    if (!api) {
      return
    }
    void api
      .lineageEngine({ path: filePath })
      .then(setEngine)
      .catch(() => setEngine(null))
  }, [filePath, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  const setDepth = useCallback((side: 'up' | 'down', delta: number) => {
    const setter = side === 'up' ? setUpstreamDepth : setDownstreamDepth
    setter((current) => Math.max(0, Math.min(20, (current ?? 1) + delta)))
  }, [])

  const toggleColumns = useCallback(() => {
    setShowColumns((current) => {
      try {
        globalThis.localStorage?.setItem(COLUMNS_STORAGE_KEY, current ? 'off' : 'on')
      } catch {
        // Why: storage can be unavailable; the toggle still applies for this session.
      }
      return !current
    })
  }, [])

  const toggleCollapse = useCallback((nodeId: string, side: 'up' | 'down') => {
    setCollapse((current) => {
      const next = new Set(current[side])
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return { ...current, [side]: next }
    })
  }, [])

  const expand = useCallback(
    async (nodeId: string, side: 'up' | 'down') => {
      const api = window.api?.ae?.dbt
      if (!api || !graph) {
        return
      }
      setLoading(true)
      try {
        const extra = await api.graph({
          path: filePath,
          model: nodeId,
          upstreamDepth: side === 'up' ? 1 : 0,
          downstreamDepth: side === 'down' ? 1 : 0
        })
        setGraph((current) => (current ? mergeLineageGraphs(current, extra) : extra))
      } catch (cause) {
        setError(podDbtErrorMessage(cause))
      } finally {
        setLoading(false)
      }
    },
    [filePath, graph]
  )

  const clickColumn = useCallback(
    async (nodeId: string, column: string) => {
      const api = window.api?.ae?.dbt
      if (!api) {
        return
      }
      const same =
        columnResult &&
        columnResult.focus.uniqueId === nodeId &&
        columnResult.focus.column.toLowerCase() === column.toLowerCase()
      if (same) {
        setColumnResult(null)
        setColumnError(null)
        return
      }
      setColumnError(null)
      try {
        setColumnResult(await api.columnLineage({ path: filePath, model: nodeId, column }))
      } catch (cause) {
        setColumnResult(null)
        setColumnError(podDbtErrorMessage(cause))
      }
    },
    [columnResult, filePath]
  )

  const parseProject = useCallback(async () => {
    const api = window.api?.ae?.dbt
    if (!api) {
      return
    }
    setLoading(true)
    try {
      await api.parse({ path: filePath })
      reload()
    } catch (cause) {
      setError(podDbtErrorMessage(cause))
      setLoading(false)
    }
  }, [filePath, reload])

  return {
    graph,
    loading,
    error,
    upstreamDepth,
    downstreamDepth,
    collapse,
    highlight: lineageHighlightFrom(columnResult),
    columnResult,
    columnError,
    focusColumn: columnResult?.focus.column ?? null,
    showColumns,
    showTree,
    selectedNodeId,
    engine,
    arrangeKey,
    reload,
    setDepth,
    toggleColumns,
    toggleTree: () => setShowTree((current) => !current),
    arrange: () => setArrangeKey((key) => key + 1),
    toggleCollapse,
    expand,
    clickColumn,
    select: setSelectedNodeId,
    parseProject
  }
}
