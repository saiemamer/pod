import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  useStore,
  type Edge,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './lineage-theme.css'
import type { DbtGraphResult } from '../../../../shared/ae/dbt-graph-types'
import {
  highlightedColumnNames,
  lineageColumnsVisible,
  lineageSideCounts,
  visibleLineageNodeIds,
  type LineageCollapse,
  type LineageHighlight
} from './lineage-canvas-state'
import { layoutLineage } from './lineage-layout'
import { PodLineageNode, type PodLineageNodeData, type PodLineageNodeType } from './PodLineageNode'

export type PodLineageCanvasProps = {
  graph: DbtGraphResult
  collapse: LineageCollapse
  highlight: LineageHighlight | null
  focusColumn: string | null
  nameMatchedNodes: Set<string>
  showColumns: boolean
  /** Bumped by Arrange to drop dragged positions and recentre. */
  arrangeKey: number
  selectedNodeId: string | null
  onColumnClick: PodLineageNodeData['onColumnClick']
  onToggleCollapse: PodLineageNodeData['onToggleCollapse']
  onExpand: PodLineageNodeData['onExpand']
  onOpen: PodLineageNodeData['onOpen']
}

const nodeTypes = { pod: PodLineageNode }

/** React Flow reads its colours from --xy-* variables; point them at the app tokens. */
const FLOW_THEME = {
  '--xy-edge-stroke-default': 'var(--border)',
  '--xy-edge-stroke-width-default': '1.5',
  '--xy-edge-stroke-selected-default': 'var(--primary)',
  '--xy-background-pattern-dots-color-default':
    'color-mix(in srgb, var(--foreground) 14%, transparent)',
  '--xy-attribution-background-color-default': 'transparent'
} as React.CSSProperties

/**
 * The graph itself. Sits inside the view's ReactFlowProvider so the toolbar can drive
 * zoom; opens at 100 percent centred on the focused model, where the reader came from.
 */
export function PodLineageCanvas(props: PodLineageCanvasProps): React.JSX.Element {
  const { graph, collapse, highlight, showColumns, arrangeKey, selectedNodeId } = props
  const zoom = useStore((state) => state.transform[2])
  const columnsVisible = lineageColumnsVisible(showColumns, zoom)
  const { fitView } = useReactFlow()
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({})

  const visible = useMemo(() => visibleLineageNodeIds(graph, collapse), [graph, collapse])
  const sides = useMemo(() => lineageSideCounts(graph, visible), [graph, visible])
  const visibleNodes = useMemo(
    () => graph.nodes.filter((node) => visible.has(node.uniqueId)),
    [graph, visible]
  )
  const placed = useMemo(
    () =>
      layoutLineage(
        visibleNodes.map((node) => ({
          id: node.uniqueId,
          columnCount: node.columns.length,
          showColumns: columnsVisible
        })),
        graph.edges
      ),
    [visibleNodes, graph.edges, columnsVisible]
  )

  const computedNodes = useMemo<PodLineageNodeType[]>(
    () =>
      visibleNodes.map((node) => ({
        id: node.uniqueId,
        type: 'pod',
        position: dragged[node.uniqueId] ?? {
          x: placed[node.uniqueId].x,
          y: placed[node.uniqueId].y
        },
        selected: node.uniqueId === selectedNodeId,
        data: {
          node,
          isFocus: node.uniqueId === graph.focus,
          showColumns: columnsVisible,
          highlighted: highlightedColumnNames(node, highlight),
          dimmed: highlight !== null && !highlight.nodes.has(node.uniqueId),
          focusColumn: props.focusColumn,
          nameMatched: props.nameMatchedNodes.has(node.uniqueId),
          moreUp: graph.moreUpstream[node.uniqueId] ?? 0,
          moreDown: graph.moreDownstream[node.uniqueId] ?? 0,
          sideUp: sides[node.uniqueId]?.up ?? 0,
          sideDown: sides[node.uniqueId]?.down ?? 0,
          collapsedUp: collapse.up.has(node.uniqueId),
          collapsedDown: collapse.down.has(node.uniqueId),
          onColumnClick: props.onColumnClick,
          onToggleCollapse: props.onToggleCollapse,
          onExpand: props.onExpand,
          onOpen: props.onOpen
        }
      })),
    [
      visibleNodes,
      dragged,
      placed,
      selectedNodeId,
      graph,
      columnsVisible,
      highlight,
      props,
      sides,
      collapse
    ]
  )

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = graph.edges
      .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
      .map((edge) => ({
        id: `n:${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        sourceHandle: 'out',
        targetHandle: 'in',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: highlight ? { opacity: 0.2 } : undefined
      }))
    if (!highlight) {
      return list
    }
    const seen = new Set<string>()
    for (const edge of highlight.edges) {
      if (!visible.has(edge.from.uniqueId) || !visible.has(edge.to.uniqueId)) {
        continue
      }
      // Why fall back to node handles: column rows are not rendered below the zoom cut.
      const sourceHandle = columnsVisible ? `out:${edge.from.column}` : 'out'
      const targetHandle = columnsVisible ? `in:${edge.to.column}` : 'in'
      const id = `c:${edge.from.uniqueId}.${sourceHandle}->${edge.to.uniqueId}.${targetHandle}`
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      list.push({
        id,
        source: edge.from.uniqueId,
        target: edge.to.uniqueId,
        sourceHandle,
        targetHandle,
        zIndex: 10,
        style: {
          stroke: 'var(--primary)',
          strokeWidth: 2,
          strokeDasharray: edge.engine === 'name-match' ? '5 4' : undefined
        }
      })
    }
    return list
  }, [graph.edges, visible, highlight, columnsVisible])

  // Why own state: in controlled mode React Flow reports each node's measured size
  // through onNodesChange and only shows nodes once that is applied back.
  const [nodes, setNodes] = useState<PodLineageNodeType[]>([])
  useEffect(() => {
    setNodes((current) => {
      const measured = new Map(current.map((node) => [node.id, node.measured]))
      return computedNodes.map((node) => ({ ...node, measured: measured.get(node.id) }))
    })
  }, [computedNodes])
  const onNodesChange = useCallback((changes: NodeChange<PodLineageNodeType>[]) => {
    setDragged((current) => {
      const next = { ...current }
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          next[change.id] = change.position
        }
      }
      return next
    })
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  useEffect(() => {
    setDragged({})
    // Why the focus at full size: fitting everything shrinks a wide graph below the zoom
    // at which columns show; the reader starts at the model they opened and pans.
    const handle = window.setTimeout(
      () => void fitView({ nodes: [{ id: graph.focus }], minZoom: 1, maxZoom: 1, duration: 0 }),
      60
    )
    return () => window.clearTimeout(handle)
  }, [graph.focus, arrangeKey, fitView])

  useEffect(() => {
    if (selectedNodeId && visible.has(selectedNodeId)) {
      void fitView({ nodes: [{ id: selectedNodeId }], duration: 200, minZoom: 1, maxZoom: 1 })
    }
  }, [selectedNodeId, visible, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.15}
      maxZoom={2.5}
      proOptions={{ hideAttribution: false }}
      style={FLOW_THEME}
      className="bg-card text-foreground"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
    </ReactFlow>
  )
}
