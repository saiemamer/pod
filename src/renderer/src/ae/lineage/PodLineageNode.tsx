import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Database, FileText, Info, Layers, Table2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DbtGraphColumn, DbtGraphNode } from '../../../../shared/ae/dbt-graph-types'
import { lineageKind } from './lineage-canvas-state'
import { useLineageColumnLit, useLineageNodeFooter } from './lineage-highlight-store'
import {
  LINEAGE_COLUMN_ROWS_MAX,
  LINEAGE_COLUMN_ROW_HEIGHT,
  LINEAGE_NODE_WIDTH
} from './lineage-layout'

export type PodLineageNodeData = {
  node: DbtGraphNode
  isFocus: boolean
  showColumns: boolean
  /** Column rows are rendered; false draws a same-height stand-in (node far off screen). */
  rowsShown: boolean
  focusColumn: string | null
  moreUp: number
  moreDown: number
  sideUp: number
  sideDown: number
  collapsedUp: boolean
  collapsedDown: boolean
  onColumnClick: (nodeId: string, column: string) => void
  onToggleCollapse: (nodeId: string, side: 'up' | 'down') => void
  onExpand: (nodeId: string, side: 'up' | 'down') => void
  onOpen: (nodeId: string) => void
}

export type PodLineageNodeType = Node<PodLineageNodeData, 'pod'>

/** True when two data objects would render the same node, so the memoised one is kept. */
export function samePodLineageNodeData(a: PodLineageNodeData, b: PodLineageNodeData): boolean {
  return (
    a.node === b.node &&
    a.isFocus === b.isFocus &&
    a.showColumns === b.showColumns &&
    a.rowsShown === b.rowsShown &&
    a.focusColumn === b.focusColumn &&
    a.moreUp === b.moreUp &&
    a.moreDown === b.moreDown &&
    a.sideUp === b.sideUp &&
    a.sideDown === b.sideDown &&
    a.collapsedUp === b.collapsedUp &&
    a.collapsedDown === b.collapsedDown &&
    a.onColumnClick === b.onColumnClick &&
    a.onToggleCollapse === b.onToggleCollapse &&
    a.onExpand === b.onExpand &&
    a.onOpen === b.onOpen
  )
}

const ResourceIcon = memo(function ResourceIcon({
  node
}: {
  node: DbtGraphNode
}): React.JSX.Element {
  if (node.resourceType === 'source') {
    return <Database className="size-3.5 shrink-0" />
  }
  if (node.resourceType === 'seed') {
    return <FileText className="size-3.5 shrink-0" />
  }
  if (node.resourceType === 'snapshot') {
    return <Layers className="size-3.5 shrink-0" />
  }
  return <Table2 className="size-3.5 shrink-0" />
})

/**
 * One column row. Reads its lit state from the highlight store, so a click re-renders
 * the rows it changed and no node; the handles exist only while lit, so React Flow
 * measures a few, not thousands.
 */
const ColumnRow = memo(function ColumnRow({
  nodeId,
  column,
  isFocusColumn,
  onColumnClick
}: {
  nodeId: string
  column: DbtGraphColumn
  isFocusColumn: boolean
  onColumnClick: PodLineageNodeData['onColumnClick']
}): React.JSX.Element {
  const isLit = useLineageColumnLit(nodeId, column.name)
  return (
    <button
      type="button"
      data-testid="pod-lineage-column"
      data-lit={isLit ? 'true' : undefined}
      className={cn(
        'nodrag relative flex h-5 w-full items-center gap-1 px-2.5 text-left text-[11px] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--foreground)_8%,var(--card))] motion-reduce:transition-none',
        isLit && 'font-medium text-primary',
        isFocusColumn && 'bg-accent'
      )}
      style={
        isLit ? { background: 'color-mix(in srgb, var(--primary) 14%, var(--card))' } : undefined
      }
      onClick={(event) => {
        event.stopPropagation()
        onColumnClick(nodeId, column.name)
      }}
    >
      {isLit && (
        <Handle
          type="target"
          position={Position.Left}
          id={`in:${column.name}`}
          className="!left-0 !size-1.5 !border-0 !bg-transparent"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{column.name}</span>
      {column.dataType && (
        <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">
          {column.dataType.toLowerCase()}
        </span>
      )}
      {isLit && (
        <Handle
          type="source"
          position={Position.Right}
          id={`out:${column.name}`}
          className="!right-0 !size-1.5 !border-0 !bg-transparent"
        />
      )}
    </button>
  )
})

type SideButtonProps = {
  side: 'up' | 'down'
  id: string
  color: string
  more: number
  loaded: number
  collapsed: boolean
  onExpand: PodLineageNodeData['onExpand']
  onToggleCollapse: PodLineageNodeData['onToggleCollapse']
}

/** Memoised on its own fields, so a highlight re-render of the node skips both buttons. */
const SideButton = memo(function SideButton({
  side,
  id,
  color,
  more,
  loaded,
  collapsed,
  onExpand,
  onToggleCollapse
}: SideButtonProps): React.JSX.Element | null {
  if (more === 0 && loaded === 0 && !collapsed) {
    return null
  }
  const what = side === 'up' ? 'parents' : 'children'
  const label = collapsed
    ? translate('pod.lineage.node.expand', 'Show hidden {{side}}', { side: what })
    : more > 0
      ? translate('pod.lineage.node.loadMore', 'Load {{count}} more {{side}}', {
          count: more,
          side: what
        })
      : translate('pod.lineage.node.collapse', 'Hide {{side}}', { side: what })
  const text = collapsed ? '+' : more > 0 ? `+${more}` : '−'
  // Why a native title: two styled tooltips per node were a visible share of a large
  // first render; the label still reaches screen readers through aria-label.
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={`pod-lineage-side-${side}`}
      className={cn(
        'nodrag absolute top-2.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border bg-card px-1 text-[10px] leading-none text-muted-foreground shadow-xs hover:text-foreground',
        side === 'up' ? '-left-2.5' : '-right-2.5'
      )}
      style={{ borderColor: color }}
      onClick={(event) => {
        event.stopPropagation()
        if (!collapsed && more > 0) {
          onExpand(id, side)
        } else {
          onToggleCollapse(id, side)
        }
      }}
    >
      {text}
    </button>
  )
})

/** The "columns matched by name" line under the rows, shown while the node is on a lit path. */
function NodeFooter({ nodeId }: { nodeId: string }): React.JSX.Element | null {
  const shown = useLineageNodeFooter(nodeId)
  if (!shown) {
    return null
  }
  return (
    <div className="mt-0.5 border-t border-border px-2.5 text-[10px] leading-4 text-muted-foreground">
      {translate('pod.lineage.node.nameMatched', 'columns matched by name')}
    </div>
  )
}

/**
 * One model on the canvas. The border and the header wash carry the materialisation
 * colour (see lineage-theme.css); the focused model glows in the same colour.
 */
function PodLineageNodeComponent({ id, data }: NodeProps<PodLineageNodeType>): React.JSX.Element {
  const { node } = data
  const kind = lineageKind(node)
  const color = `var(--pod-lineage-${kind})`
  const rows = data.showColumns ? node.columns.slice(0, LINEAGE_COLUMN_ROWS_MAX) : []
  const hidden = data.showColumns ? node.columns.length - rows.length : 0
  const inferred = node.columnSource !== 'catalog' && node.columns.length > 0
  return (
    <div
      data-testid="pod-lineage-node"
      data-node-id={node.uniqueId}
      data-kind={kind}
      // Why the class: a node off a lit path is dimmed by lineage-theme.css through the
      // wrapper's class, so the node itself does not re-render for it.
      className="pod-lineage-box relative rounded-md border bg-card text-card-foreground transition-opacity"
      style={{
        width: LINEAGE_NODE_WIDTH,
        borderColor: color,
        // Why a glow: the focus node must be found at a glance among dozens; the ring
        // token is reserved for keyboard focus, so the halo uses the node's own colour.
        boxShadow: data.isFocus
          ? `0 0 0 1px ${color}, 0 0 16px color-mix(in srgb, ${color} 45%, transparent)`
          : undefined
      }}
      onDoubleClick={() => data.onOpen(id)}
    >
      {/* Why 20px: the header is 40px tall, so node edges meet the box at the title row. */}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!size-2 !border-0"
        style={{ background: color, top: 20 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!size-2 !border-0"
        style={{ background: color, top: 20 }}
      />
      <SideButton
        side="up"
        id={id}
        color={color}
        more={data.moreUp}
        loaded={data.sideUp}
        collapsed={data.collapsedUp}
        onExpand={data.onExpand}
        onToggleCollapse={data.onToggleCollapse}
      />
      <SideButton
        side="down"
        id={id}
        color={color}
        more={data.moreDown}
        loaded={data.sideDown}
        collapsed={data.collapsedDown}
        onExpand={data.onExpand}
        onToggleCollapse={data.onToggleCollapse}
      />
      <div
        className="flex h-10 items-center gap-1.5 rounded-t-[calc(var(--radius-md)-1px)] px-2.5"
        style={{
          background: `color-mix(in srgb, ${color} 12%, var(--card))`,
          borderBottom: `1px solid color-mix(in srgb, ${color} 35%, transparent)`
        }}
        title={node.path}
      >
        <span style={{ color }}>
          <ResourceIcon node={node} />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{node.name}</span>
        {inferred && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground">
                <Info className="size-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {node.columnSource === 'inherited'
                ? translate('pod.lineage.node.inherited', 'Columns inherited from parents')
                : node.columnSource === 'parsed'
                  ? translate('pod.lineage.node.parsed', 'Columns read from the SQL')
                  : translate('pod.lineage.node.manifestColumns', 'Columns from the model docs')}
            </TooltipContent>
          </Tooltip>
        )}
        <span className="shrink-0 text-[10px] leading-4" style={{ color }}>
          {node.materialized ?? node.resourceType}
        </span>
      </div>
      {rows.length > 0 &&
        !data.rowsShown && (
          // Why a stand-in: rows cost the most to render, so nodes far off screen carry a
          // block of the same height until they come within a screen of the viewport.
          <div
            className="pod-lineage-rows pod-lineage-rows-pending rounded-b-[calc(var(--radius-md)-1px)]"
            data-testid="pod-lineage-rows-pending"
            style={{ height: (rows.length + (hidden > 0 ? 1 : 0)) * LINEAGE_COLUMN_ROW_HEIGHT }}
          />
        )}
      {rows.length > 0 &&
        data.rowsShown && (
          // Why round the last row itself: clipping the list with overflow-hidden put it on
          // its own compositing layer, which left a seam beside the border when zoomed.
          <div className="pod-lineage-rows [&>*:last-child]:rounded-b-[calc(var(--radius-md)-1px)]">
            {rows.map((column) => (
              <ColumnRow
                key={column.name}
                nodeId={id}
                column={column}
                isFocusColumn={
                  data.isFocus && data.focusColumn?.toLowerCase() === column.name.toLowerCase()
                }
                onColumnClick={data.onColumnClick}
              />
            ))}
            {hidden > 0 && (
              <div className="h-5 px-2.5 text-[11px] leading-5 text-muted-foreground">
                {translate('pod.lineage.node.moreColumns', '+{{count}} more columns', {
                  count: hidden
                })}
              </div>
            )}
            <NodeFooter nodeId={id} />
          </div>
        )}
    </div>
  )
}

export const PodLineageNode = memo(PodLineageNodeComponent)
