import { useCallback, useMemo, useRef, useState } from 'react'
import type { DbtGraphEdge, DbtGraphNode } from '../../../../shared/ae/dbt-graph-types'
import { layoutLineage, type LineageLayoutResult } from './lineage-layout'

const NO_EXPANDED: ReadonlySet<string> = new Set()

/**
 * Pod: dagre placement for the visible nodes, and which nodes list every column
 * (expanding one changes its height, so it is part of the layout).
 */
export function useLineageLayout(
  visibleNodes: DbtGraphNode[],
  edges: DbtGraphEdge[],
  showColumns: boolean
): {
  laidOut: LineageLayoutResult
  expanded: ReadonlySet<string>
  toggleColumns: (nodeId: string) => void
} {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_EXPANDED)
  const toggleColumns = useCallback((nodeId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(nodeId)) {
        next.add(nodeId)
      }
      return next
    })
  }, [])
  // Why a ref beside useMemo: StrictMode runs the calculation twice per change in
  // development, and dagre on a hundred nodes is the slowest step of a pass.
  const layoutCache = useRef<{
    nodes: DbtGraphNode[]
    edges: DbtGraphEdge[]
    showColumns: boolean
    expanded: ReadonlySet<string>
    result: LineageLayoutResult
  } | null>(null)
  const laidOut = useMemo(() => {
    const cached = layoutCache.current
    if (
      cached &&
      cached.nodes === visibleNodes &&
      cached.edges === edges &&
      cached.showColumns === showColumns &&
      cached.expanded === expanded
    ) {
      return cached.result
    }
    const result = layoutLineage(
      visibleNodes.map((node) => ({
        id: node.uniqueId,
        columnCount: node.columns.length,
        showColumns,
        expanded: expanded.has(node.uniqueId)
      })),
      edges
    )
    layoutCache.current = {
      nodes: visibleNodes,
      edges,
      showColumns,
      expanded,
      result
    }
    return result
  }, [visibleNodes, edges, showColumns, expanded])
  return { laidOut, expanded, toggleColumns }
}
