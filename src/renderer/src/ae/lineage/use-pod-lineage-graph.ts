import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const EMPTY_NAME_MATCHED: ReadonlySet<string> = new Set()

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
  /** Models the engine could not read, whose columns were matched by name. Stable per answer. */
  nameMatchedNodes: ReadonlySet<string>
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
  // Why "requested": the depth the reader asked for, null until they touch a stepper.
  // Echoing the answer's depth into state re-ran the fetch and rebuilt every node once
  // per open.
  const [requested, setRequested] = useState<{ up: number | null; down: number | null }>({
    up: null,
    down: null
  })
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
  // Why refs: the callbacks below reach every node as data; reading the latest graph
  // and answer through refs keeps their identity fixed, so a click re-renders the
  // rows it lit and not every node.
  const latestGraph = useRef<DbtGraphResult | null>(null)
  latestGraph.current = graph
  const latestColumnResult = useRef<DbtColumnLineageResult | null>(null)
  latestColumnResult.current = columnResult

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
        ...(requested.up !== null ? { upstreamDepth: requested.up } : {}),
        ...(requested.down !== null ? { downstreamDepth: requested.down } : {})
      })
      .then((result) => {
        if (requestId.current !== id) {
          return
        }
        setGraph(result)
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
  }, [filePath, requested, reloadKey])

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
    const shown = latestGraph.current
    setRequested((current) => {
      const key = side === 'up' ? 'up' : 'down'
      const base =
        current[key] ?? (side === 'up' ? shown?.upstreamDepth : shown?.downstreamDepth) ?? 1
      return { ...current, [key]: Math.max(0, Math.min(20, base + delta)) }
    })
  }, [])

  const toggleColumns = useCallback(() => {
    // Why outside the updater: React may run an updater twice; storage is written once.
    const next = !showColumns
    try {
      globalThis.localStorage?.setItem(COLUMNS_STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // Why: storage can be unavailable; the toggle still applies for this session.
    }
    setShowColumns(next)
  }, [showColumns])

  const toggleTree = useCallback(() => setShowTree((current) => !current), [])
  const arrange = useCallback(() => setArrangeKey((key) => key + 1), [])

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
      if (!api || !latestGraph.current) {
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
    [filePath]
  )

  const clickColumn = useCallback(
    async (nodeId: string, column: string) => {
      const api = window.api?.ae?.dbt
      if (!api) {
        return
      }
      const current = latestColumnResult.current
      const same =
        current &&
        current.focus.uniqueId === nodeId &&
        current.focus.column.toLowerCase() === column.toLowerCase()
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
    [filePath]
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

  // Why memo: the canvas rebuilds every node's data when these change identity, so
  // they must only change when the answer does.
  const highlight = useMemo(() => lineageHighlightFrom(columnResult), [columnResult])
  const nameMatchedNodes = useMemo<ReadonlySet<string>>(
    () =>
      columnResult && columnResult.nameMatchedNodes.length > 0
        ? new Set(columnResult.nameMatchedNodes)
        : EMPTY_NAME_MATCHED,
    [columnResult]
  )

  return {
    graph,
    loading,
    error,
    upstreamDepth: requested.up ?? graph?.upstreamDepth ?? null,
    downstreamDepth: requested.down ?? graph?.downstreamDepth ?? null,
    collapse,
    highlight,
    columnResult,
    columnError,
    focusColumn: columnResult?.focus.column ?? null,
    nameMatchedNodes,
    showColumns,
    showTree,
    selectedNodeId,
    engine,
    arrangeKey,
    reload,
    setDepth,
    toggleColumns,
    toggleTree,
    arrange,
    toggleCollapse,
    expand,
    clickColumn,
    select: setSelectedNodeId,
    parseProject
  }
}
