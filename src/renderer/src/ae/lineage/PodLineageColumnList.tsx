import { memo, useMemo, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DbtGraphColumn } from '../../../../shared/ae/dbt-graph-types'
import {
  useLineageColumnLit,
  useLineageNodeFooter,
  useLineageNodeLit
} from './lineage-highlight-store'
import { LINEAGE_FILTER_MIN_COLUMNS, lineageExpandedScrollHeight } from './lineage-layout'
import { lineageNodeRows } from './lineage-node-rows'

type ColumnClick = (nodeId: string, column: string) => void

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
  onColumnClick: ColumnClick
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

type ColumnListProps = {
  nodeId: string
  columns: DbtGraphColumn[]
  expanded: boolean
  focusColumn: string | null
  onColumnClick: ColumnClick
  onToggleColumns: (nodeId: string) => void
}

/**
 * A node's column rows, bounded (see lineage-node-rows.ts). Subscribes to the node's
 * lit columns itself, so a click re-renders the lists on the path, not their nodes.
 */
export const PodLineageColumnList = memo(function PodLineageColumnList({
  nodeId,
  columns,
  expanded,
  focusColumn,
  onColumnClick,
  onToggleColumns
}: ColumnListProps): React.JSX.Element {
  const lit = useLineageNodeLit(nodeId)
  const [filter, setFilter] = useState('')
  const { pinned, rows, hidden } = useMemo(
    () => lineageNodeRows(columns, { expanded, lit, filter }),
    [columns, expanded, lit, filter]
  )
  const row = (column: DbtGraphColumn): React.JSX.Element => (
    <ColumnRow
      key={column.name}
      nodeId={nodeId}
      column={column}
      isFocusColumn={focusColumn?.toLowerCase() === column.name.toLowerCase()}
      onColumnClick={onColumnClick}
    />
  )
  const toggle = (event: React.MouseEvent): void => {
    event.stopPropagation()
    onToggleColumns(nodeId)
  }
  // Why round the last row itself: clipping the list with overflow-hidden put it on
  // its own compositing layer, which left a seam beside the border when zoomed.
  return (
    <div className="pod-lineage-rows [&>*:last-child]:rounded-b-[calc(var(--radius-md)-1px)]">
      {expanded && columns.length > LINEAGE_FILTER_MIN_COLUMNS && (
        <div className="flex h-7 items-center px-1.5">
          <input
            type="text"
            value={filter}
            data-testid="pod-lineage-column-filter"
            aria-label={translate('pod.lineage.node.filterColumns', 'Filter columns')}
            placeholder={translate('pod.lineage.node.filterColumns', 'Filter columns')}
            className="nodrag h-5 w-full rounded-sm border border-input bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
      )}
      {pinned.map(row)}
      {expanded ? (
        // Why nowheel: the wheel scrolls the list here instead of zooming the canvas.
        <div
          className="nodrag nowheel scrollbar-sleek overflow-y-auto"
          data-testid="pod-lineage-column-scroll"
          style={{ height: lineageExpandedScrollHeight(columns.length) }}
        >
          {rows.map(row)}
        </div>
      ) : (
        rows.map(row)
      )}
      {hidden > 0 && (
        <button
          type="button"
          data-testid="pod-lineage-more-columns"
          className="nodrag h-5 w-full px-2.5 text-left text-[11px] leading-5 text-muted-foreground hover:text-foreground"
          onClick={toggle}
        >
          {translate('pod.lineage.node.moreColumns', '+{{count}} more columns', { count: hidden })}
        </button>
      )}
      {expanded && (
        <button
          type="button"
          data-testid="pod-lineage-fewer-columns"
          className="nodrag h-5 w-full px-2.5 text-left text-[11px] leading-5 text-muted-foreground hover:text-foreground"
          onClick={toggle}
        >
          {translate('pod.lineage.node.fewerColumns', 'Show fewer columns')}
        </button>
      )}
      <NodeFooter nodeId={nodeId} />
    </div>
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
