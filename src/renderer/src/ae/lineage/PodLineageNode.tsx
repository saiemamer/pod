import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Database, FileText, Info, Layers, Table2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DbtGraphNode } from '../../../../shared/ae/dbt-graph-types'
import { LINEAGE_COLUMN_ROWS_MAX, LINEAGE_NODE_WIDTH } from './lineage-layout'

export type PodLineageNodeData = {
  node: DbtGraphNode
  isFocus: boolean
  showColumns: boolean
  highlighted: string[]
  dimmed: boolean
  focusColumn: string | null
  nameMatched: boolean
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

/** Header wash per materialisation, mixed from the chart ramp so light and dark agree. */
function headerBackground(node: DbtGraphNode): string {
  const token =
    node.resourceType === 'source'
      ? '--chart-1'
      : node.resourceType === 'seed' || node.resourceType === 'snapshot'
        ? '--chart-5'
        : node.materialized === 'incremental'
          ? '--chart-4'
          : node.materialized === 'view'
            ? '--chart-2'
            : node.materialized === 'ephemeral'
              ? '--muted-foreground'
              : '--chart-3'
  return `color-mix(in srgb, var(${token}) 18%, var(--card))`
}

function ResourceIcon({ node }: { node: DbtGraphNode }): React.JSX.Element {
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
}

function SideButton({
  side,
  data,
  id
}: {
  side: 'up' | 'down'
  data: PodLineageNodeData
  id: string
}): React.JSX.Element | null {
  const more = side === 'up' ? data.moreUp : data.moreDown
  const loaded = side === 'up' ? data.sideUp : data.sideDown
  const collapsed = side === 'up' ? data.collapsedUp : data.collapsedDown
  if (more === 0 && loaded === 0 && !collapsed) {
    return null
  }
  const label = collapsed
    ? translate('pod.lineage.node.expand', 'Show hidden {{side}}', {
        side: side === 'up' ? 'parents' : 'children'
      })
    : more > 0
      ? translate('pod.lineage.node.loadMore', 'Load {{count}} more {{side}}', {
          count: more,
          side: side === 'up' ? 'parents' : 'children'
        })
      : translate('pod.lineage.node.collapse', 'Hide {{side}}', {
          side: side === 'up' ? 'parents' : 'children'
        })
  const text = collapsed ? '+' : more > 0 ? `+${more}` : '−'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={`pod-lineage-side-${side}`}
          className={cn(
            'nodrag absolute top-2.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-card px-1 text-[10px] leading-none text-muted-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
            side === 'up' ? '-left-2.5' : '-right-2.5'
          )}
          onClick={(event) => {
            event.stopPropagation()
            if (!collapsed && more > 0) {
              data.onExpand(id, side)
            } else {
              data.onToggleCollapse(id, side)
            }
          }}
        >
          {text}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function PodLineageNodeComponent({ id, data }: NodeProps<PodLineageNodeType>): React.JSX.Element {
  const { node } = data
  const lit = new Set(data.highlighted.map((name) => name.toLowerCase()))
  const rows = data.showColumns ? node.columns.slice(0, LINEAGE_COLUMN_ROWS_MAX) : []
  const hidden = data.showColumns ? node.columns.length - rows.length : 0
  const inferred = node.columnSource !== 'catalog' && node.columns.length > 0
  return (
    <div
      data-testid="pod-lineage-node"
      data-node-id={node.uniqueId}
      className={cn(
        'relative rounded-md border border-border bg-card text-card-foreground shadow-xs transition-opacity',
        data.isFocus && 'ring-2 ring-ring',
        data.dimmed && 'opacity-40'
      )}
      style={{ width: LINEAGE_NODE_WIDTH }}
      onDoubleClick={() => data.onOpen(id)}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!size-2 !border-0 !bg-border"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!size-2 !border-0 !bg-border"
      />
      <SideButton side="up" data={data} id={id} />
      <SideButton side="down" data={data} id={id} />
      <div
        className="flex h-10 items-center gap-1.5 rounded-t-md px-2.5"
        style={{ background: headerBackground(node) }}
        title={node.path}
      >
        <ResourceIcon node={node} />
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
        <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted-foreground">
          {node.materialized ?? node.resourceType}
        </span>
      </div>
      {rows.length > 0 && (
        <div className="py-0.5">
          {rows.map((column) => {
            const isLit = lit.has(column.name.toLowerCase())
            const isFocusColumn =
              data.isFocus && data.focusColumn?.toLowerCase() === column.name.toLowerCase()
            return (
              <button
                key={column.name}
                type="button"
                data-testid="pod-lineage-column"
                data-lit={isLit ? 'true' : undefined}
                className={cn(
                  'nodrag relative flex h-5 w-full items-center gap-1 px-2.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground',
                  isLit && 'font-medium text-primary',
                  isFocusColumn && 'bg-accent'
                )}
                style={
                  isLit
                    ? { background: 'color-mix(in srgb, var(--primary) 12%, var(--card))' }
                    : undefined
                }
                onClick={(event) => {
                  event.stopPropagation()
                  data.onColumnClick(id, column.name)
                }}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`in:${column.name}`}
                  className="!left-0 !size-1.5 !border-0 !bg-transparent"
                />
                <span className="min-w-0 flex-1 truncate">{column.name}</span>
                {column.dataType && (
                  <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                    {column.dataType.toLowerCase()}
                  </span>
                )}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`out:${column.name}`}
                  className="!right-0 !size-1.5 !border-0 !bg-transparent"
                />
              </button>
            )
          })}
          {hidden > 0 && (
            <div className="h-5 px-2.5 text-[11px] leading-5 text-muted-foreground">
              {translate('pod.lineage.node.moreColumns', '+{{count}} more columns', {
                count: hidden
              })}
            </div>
          )}
        </div>
      )}
      {data.nameMatched && data.showColumns && (
        <div className="border-t border-border px-2.5 text-[10px] leading-4 text-muted-foreground">
          {translate('pod.lineage.node.nameMatched', 'columns matched by name')}
        </div>
      )}
    </div>
  )
}

export const PodLineageNode = memo(PodLineageNodeComponent)
