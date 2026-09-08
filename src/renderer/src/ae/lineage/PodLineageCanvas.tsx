import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useStoreApi,
  useUpdateNodeInternals,
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
import { LineageHighlightContext, createLineageHighlightStore } from './lineage-highlight-store'
import { layoutLineage, type LineageLayoutResult } from './lineage-layout'
import { useLineageFirstMount } from './use-lineage-first-mount'
import { useLineageRowsWindow } from './use-lineage-rows-window'
import { useTweenedPositions } from './use-tweened-positions'
import {
  PodLineageNode,
  samePodLineageNodeData,
  type PodLineageNodeData,
  type PodLineageNodeType
} from './PodLineageNode'

export type PodLineageCanvasProps = {
  graph: DbtGraphResult
  collapse: LineageCollapse
  highlight: LineageHighlight | null
  focusColumn: string | null
  nameMatchedNodes: ReadonlySet<string>
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

const NODE_EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 14, height: 14 } as const
const LIT_EDGE_STYLE = { stroke: 'var(--primary)', strokeWidth: 2 } as const
const LIT_EDGE_STYLE_NAME_MATCH = { ...LIT_EDGE_STYLE, strokeDasharray: '5 4' } as const
const NO_IDS: string[] = []

/** React Flow's own warning, minus the one for a handle it has not measured yet. */
function onFlowError(code: string, message: string): void {
  // Why skip 008: a lit row mounts its handles in the same commit as the edge that
  // needs them; the effect below measures them right after, and the edge draws.
  if (code !== '008') {
    console.warn(`[React Flow]: ${message}`)
  }
}

type Point = { x: number; y: number }

/** True when a node object React Flow already holds says the same as a fresh one. */
function sameFlowNode(previous: PodLineageNodeType, next: PodLineageNodeType): boolean {
  return (
    previous.data === next.data &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y &&
    previous.selected === next.selected &&
    previous.className === next.className
  )
}

function sameEdge(previous: Edge, next: Edge): boolean {
  return (
    previous.sourceHandle === next.sourceHandle &&
    previous.targetHandle === next.targetHandle &&
    previous.className === next.className &&
    previous.style === next.style
  )
}

/**
 * The graph itself. Sits inside the view's ReactFlowProvider so the toolbar can drive
 * zoom. Stays invisible until the nodes are measured and the viewport sits at 100
 * percent on the focused model, then fades in already in place; layout changes tween
 * the nodes to their new spots so edges travel with them.
 *
 * Node and edge objects keep their identity unless something they show changed: React
 * Flow skips an object it has seen, and the node component is memoised on its data, so
 * a column click or a tween re-renders what it touches, not everything. Column rows
 * exist only for nodes near the viewport (see use-lineage-rows-window.ts).
 */
export function PodLineageCanvas(props: PodLineageCanvasProps): React.JSX.Element {
  const { graph, collapse, highlight, showColumns, arrangeKey, selectedNodeId } = props
  const columnsVisible = useStore((state) => lineageColumnsVisible(showColumns, state.transform[2]))
  const { fitView } = useReactFlow()
  const store = useStoreApi()
  const nodesInitialized = useNodesInitialized()
  const [dragged, setDragged] = useState<Record<string, Point>>({})
  const [ready, setReady] = useState(false)
  const pendingFit = useRef<string | null>(null)

  const visible = useMemo(() => visibleLineageNodeIds(graph, collapse), [graph, collapse])
  const sides = useMemo(() => lineageSideCounts(graph, visible), [graph, visible])
  const visibleNodes = useMemo(
    () => graph.nodes.filter((node) => visible.has(node.uniqueId)),
    [graph, visible]
  )
  // Why only on the path: the footer explains lit edges, and the engine may fall back
  // on most of a neighbourhood; footers everywhere re-laid out the canvas per click.
  const { nameMatchedNodes } = props
  const footerKey = useMemo(
    () =>
      highlight
        ? [...highlight.nodes]
            .filter((id) => nameMatchedNodes.has(id))
            .sort()
            .join('|')
        : '',
    [highlight, nameMatchedNodes]
  )
  const footers = useMemo(() => new Set(footerKey ? footerKey.split('|') : NO_IDS), [footerKey])
  // Why a store: rows and footers subscribe to it, so a click re-renders those and no
  // node (see lineage-highlight-store.ts).
  const [highlightStore] = useState(createLineageHighlightStore)
  useEffect(() => {
    const lit = new Map<string, ReadonlySet<string>>()
    if (highlight) {
      for (const node of visibleNodes) {
        const names = highlightedColumnNames(node, highlight)
        if (names.length > 0) {
          lit.set(node.uniqueId, new Set(names.map((name) => name.toLowerCase())))
        }
      }
    }
    highlightStore.setState({ lit, footers })
  }, [highlight, visibleNodes, footers, highlightStore])
  // Why a ref beside useMemo: StrictMode runs the calculation twice per change in
  // development, and dagre on a hundred nodes is the slowest step of a pass.
  const layoutCache = useRef<{
    nodes: typeof visibleNodes
    edges: typeof graph.edges
    showColumns: boolean
    result: LineageLayoutResult
  } | null>(null)
  const placed = useMemo(() => {
    const cached = layoutCache.current
    if (
      cached &&
      cached.nodes === visibleNodes &&
      cached.edges === graph.edges &&
      cached.showColumns === showColumns
    ) {
      return cached.result
    }
    const result = layoutLineage(
      visibleNodes.map((node) => ({
        id: node.uniqueId,
        columnCount: node.columns.length,
        showColumns
      })),
      graph.edges
    )
    layoutCache.current = { nodes: visibleNodes, edges: graph.edges, showColumns, result }
    return result
  }, [visibleNodes, graph.edges, showColumns])
  const positions = useTweenedPositions(placed)

  const rowsShown = useLineageRowsWindow(placed, dragged, columnsVisible)

  const firstMount = useLineageFirstMount(placed, graph.focus, ready)

  // Why caches: a node's data object is handed to a memoised component, and its node
  // object to React Flow's equality check; both must survive a pass that changed
  // nothing about that node.
  const dataCache = useRef(new Map<string, PodLineageNodeData>())
  const nodeCache = useRef(new Map<string, PodLineageNodeType>())
  const computedNodes = useMemo<PodLineageNodeType[]>(() => {
    const nextData = new Map<string, PodLineageNodeData>()
    const nextNodes = new Map<string, PodLineageNodeType>()
    const staged = firstMount
      ? visibleNodes.filter((node) => firstMount.has(node.uniqueId))
      : visibleNodes
    const list = staged.map((node) => {
      const id = node.uniqueId
      const candidate: PodLineageNodeData = {
        node,
        isFocus: id === graph.focus,
        showColumns,
        rowsShown: rowsShown.has(id),
        // Why only on the focus: the clicked column marks one row on one node; on
        // every node it changed every node's data per click.
        focusColumn: id === graph.focus ? props.focusColumn : null,
        moreUp: graph.moreUpstream[id] ?? 0,
        moreDown: graph.moreDownstream[id] ?? 0,
        sideUp: sides[id]?.up ?? 0,
        sideDown: sides[id]?.down ?? 0,
        collapsedUp: collapse.up.has(id),
        collapsedDown: collapse.down.has(id),
        onColumnClick: props.onColumnClick,
        onToggleCollapse: props.onToggleCollapse,
        onExpand: props.onExpand,
        onOpen: props.onOpen
      }
      const previousData = dataCache.current.get(id)
      const data =
        previousData && samePodLineageNodeData(previousData, candidate) ? previousData : candidate
      nextData.set(id, data)
      const onPath = highlight !== null && highlight.nodes.has(id)
      const fresh: PodLineageNodeType = {
        id,
        type: 'pod',
        // Why classes: the mount animation and the dimming live in lineage-theme.css;
        // marking the path (not the rest) leaves every other node's object untouched.
        className: onPath ? 'pod-lineage-enter pod-lineage-lit-node' : 'pod-lineage-enter',
        position: dragged[id] ?? positions[id] ?? { x: placed[id].x, y: placed[id].y },
        selected: id === selectedNodeId,
        data
      }
      const previousNode = nodeCache.current.get(id)
      const flowNode = previousNode && sameFlowNode(previousNode, fresh) ? previousNode : fresh
      nextNodes.set(id, flowNode)
      return flowNode
    })
    dataCache.current = nextData
    nodeCache.current = nextNodes
    return list
  }, [
    visibleNodes,
    firstMount,
    dragged,
    positions,
    placed,
    selectedNodeId,
    graph,
    showColumns,
    rowsShown,
    highlight,
    props.focusColumn,
    props.onColumnClick,
    props.onToggleCollapse,
    props.onExpand,
    props.onOpen,
    sides,
    collapse
  ])

  const edgeCache = useRef(new Map<string, Edge>())
  const edges = useMemo<Edge[]>(() => {
    const next = new Map<string, Edge>()
    const keep = (edge: Edge): Edge => {
      const previous = edgeCache.current.get(edge.id)
      const kept = previous && sameEdge(previous, edge) ? previous : edge
      next.set(edge.id, kept)
      return kept
    }
    const shown = (id: string): boolean => visible.has(id) && (!firstMount || firstMount.has(id))
    const list: Edge[] = graph.edges
      .filter((edge) => shown(edge.source) && shown(edge.target))
      .map((edge) =>
        keep({
          id: `n:${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          sourceHandle: 'out',
          targetHandle: 'in',
          markerEnd: NODE_EDGE_MARKER
        })
      )
    if (highlight) {
      const seen = new Set<string>()
      for (const edge of highlight.edges) {
        if (!shown(edge.from.uniqueId) || !shown(edge.to.uniqueId)) {
          continue
        }
        // Why fall back to node handles: column rows are hidden below the zoom cut and
        // absent on nodes far off screen, and an edge needs a handle that exists.
        const fromRows = columnsVisible && rowsShown.has(edge.from.uniqueId)
        const toRows = columnsVisible && rowsShown.has(edge.to.uniqueId)
        const sourceHandle = fromRows ? `out:${edge.from.column}` : 'out'
        const targetHandle = toRows ? `in:${edge.to.column}` : 'in'
        const id = `c:${edge.from.uniqueId}.${sourceHandle}->${edge.to.uniqueId}.${targetHandle}`
        if (seen.has(id)) {
          continue
        }
        seen.add(id)
        list.push(
          keep({
            id,
            source: edge.from.uniqueId,
            target: edge.to.uniqueId,
            sourceHandle,
            targetHandle,
            zIndex: 10,
            className: 'pod-lineage-enter pod-lineage-lit',
            style: edge.engine === 'name-match' ? LIT_EDGE_STYLE_NAME_MATCH : LIT_EDGE_STYLE
          })
        )
      }
    }
    edgeCache.current = next
    return list
  }, [graph.edges, visible, firstMount, highlight, columnsVisible, rowsShown])

  // Why own state: in controlled mode React Flow reports each node's measured size
  // through onNodesChange and only shows nodes once that is applied back. A node it
  // has measured is kept as is when the computed node says the same.
  const [nodes, setNodes] = useState<PodLineageNodeType[]>([])
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]))
      let unchanged = current.length === computedNodes.length
      const next = computedNodes.map((node, index) => {
        const previous = byId.get(node.id)
        const kept = previous && sameFlowNode(previous, node) ? previous : undefined
        if (!kept || current[index] !== kept) {
          unchanged = false
        }
        return kept ?? { ...node, measured: previous?.measured }
      })
      return unchanged ? current : next
    })
  }, [computedNodes])
  const onNodesChange = useCallback((changes: NodeChange<PodLineageNodeType>[]) => {
    const moved: [string, Point][] = []
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        moved.push([change.id, change.position])
      }
    }
    if (moved.length > 0) {
      setDragged((current) => ({ ...current, ...Object.fromEntries(moved) }))
    }
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  // Why gate on measurement: fitting before the nodes have a size centres on nothing,
  // and showing them before the fit is the zoom-out-then-in the reader would notice.
  // Why during render: a new focus or an Arrange must reset the view in the same pass.
  const fitKey = `${graph.focus}|${arrangeKey}`
  const [fitFor, setFitFor] = useState<string | null>(null)
  if (fitFor !== fitKey) {
    setFitFor(fitKey)
    setDragged({})
    setReady(false)
    pendingFit.current = graph.focus
  }
  useEffect(() => {
    const target = pendingFit.current
    if (!target || !nodesInitialized) {
      return
    }
    // Why read the store: the subscribed flag can lag one render behind a node swap,
    // and the fit needs the focus itself measured; a later measurement re-runs this.
    const focus = store.getState().nodeLookup.get(target)
    if (!focus?.measured?.width) {
      return
    }
    pendingFit.current = null
    void fitView({ nodes: [{ id: target }], minZoom: 1, maxZoom: 1, duration: 0 }).then(() =>
      setReady(true)
    )
  }, [nodesInitialized, fitView, nodes, fitFor, store])

  // Why measure by hand: React Flow measures handles when a node mounts or resizes, and
  // a lit row adds handles to a node that does neither.
  const updateNodeInternals = useUpdateNodeInternals()
  const litKey = useMemo(
    () =>
      highlight && columnsVisible
        ? [...highlight.nodes]
            .filter((id) => rowsShown.has(id))
            .sort()
            .join('|')
        : '',
    [highlight, columnsVisible, rowsShown]
  )
  useEffect(() => {
    if (!litKey) {
      return
    }
    // Why a frame later: measuring forces a layout, and the click's own commit is long
    // enough; the column edges appear one frame after the rows light.
    const frame = requestAnimationFrame(() => updateNodeInternals(litKey.split('|')))
    return () => cancelAnimationFrame(frame)
  }, [litKey, updateNodeInternals])

  useEffect(() => {
    if (selectedNodeId && visible.has(selectedNodeId)) {
      void fitView({ nodes: [{ id: selectedNodeId }], duration: 200, minZoom: 1, maxZoom: 1 })
    }
  }, [selectedNodeId, visible, fitView])

  return (
    <div
      data-testid="pod-lineage-canvas"
      data-ready={ready ? 'true' : 'false'}
      // Why attributes: below the zoom cut the column rows are hidden by a stylesheet
      // rule, and with a column lit the other edges fade by one; neither touches a node
      // or edge object.
      data-columns={columnsVisible ? 'shown' : 'hidden'}
      data-highlight={highlight ? 'true' : 'false'}
      className="h-full w-full transition-opacity duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
      style={{ opacity: ready ? 1 : 0 }}
    >
      <LineageHighlightContext.Provider value={highlightStore}>
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
          onError={onFlowError}
          style={FLOW_THEME}
          className="bg-card text-foreground"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        </ReactFlow>
      </LineageHighlightContext.Provider>
    </div>
  )
}
