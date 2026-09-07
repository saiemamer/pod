import { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DbtGraphResult } from '../../../../shared/ae/dbt-graph-types'

type TreeRow = { id: string; name: string; depth: number; more: number }

/** Depth-first rows away from the focus, each node listed once at its shallowest depth. */
export function lineageTreeRows(
  graph: DbtGraphResult,
  side: 'up' | 'down',
  maxDepth: number
): TreeRow[] {
  const next = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const [from, to] = side === 'up' ? [edge.target, edge.source] : [edge.source, edge.target]
    next.set(from, [...(next.get(from) ?? []), to])
  }
  const names = new Map(graph.nodes.map((node) => [node.uniqueId, node.name]))
  const more = side === 'up' ? graph.moreUpstream : graph.moreDownstream
  const rows: TreeRow[] = []
  const seen = new Set<string>([graph.focus])
  const walk = (id: string, depth: number): void => {
    if (depth > maxDepth) {
      return
    }
    const children = (next.get(id) ?? []).sort((a, b) =>
      (names.get(a) ?? a).localeCompare(names.get(b) ?? b)
    )
    for (const child of children) {
      if (seen.has(child)) {
        continue
      }
      seen.add(child)
      rows.push({ id: child, name: names.get(child) ?? child, depth, more: more[child] ?? 0 })
      walk(child, depth + 1)
    }
  }
  walk(graph.focus, 1)
  return rows
}

export type PodLineageTreeProps = {
  graph: DbtGraphResult
  maxDepth: number
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
  onOpen: (nodeId: string) => void
}

function Section({
  title,
  rows,
  more,
  selectedNodeId,
  onSelect,
  onOpen
}: {
  title: string
  rows: TreeRow[]
  more: number
} & Pick<PodLineageTreeProps, 'selectedNodeId' | 'onSelect' | 'onOpen'>): React.JSX.Element {
  return (
    <div className="py-1">
      <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({rows.length})
      </div>
      {rows.length === 0 && (
        <div className="px-2 text-[11px] text-muted-foreground">
          {translate('pod.lineage.tree.none', 'none')}
        </div>
      )}
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className={cn(
            'flex h-5 w-full items-center gap-1 truncate px-2 text-left text-[11px] hover:bg-accent hover:text-accent-foreground',
            selectedNodeId === row.id && 'bg-accent'
          )}
          style={{ paddingLeft: 8 + (row.depth - 1) * 12 }}
          onClick={() => onSelect(row.id)}
          onDoubleClick={() => onOpen(row.id)}
        >
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          {row.more > 0 && <span className="shrink-0 text-muted-foreground">+{row.more}</span>}
        </button>
      ))}
      {more > 0 && (
        <div className="px-2 text-[11px] text-muted-foreground">
          {translate('pod.lineage.tree.moreAtFocus', '+{{count}} more not loaded', { count: more })}
        </div>
      )}
    </div>
  )
}

/** Upstream and downstream lists beside the canvas; single click centres, double click opens. */
export function PodLineageTree(props: PodLineageTreeProps): React.JSX.Element {
  const up = useMemo(
    () => lineageTreeRows(props.graph, 'up', props.maxDepth),
    [props.graph, props.maxDepth]
  )
  const down = useMemo(
    () => lineageTreeRows(props.graph, 'down', props.maxDepth),
    [props.graph, props.maxDepth]
  )
  return (
    <div
      className="flex w-56 shrink-0 flex-col overflow-auto scrollbar-sleek border-l border-border/60"
      data-testid="pod-lineage-tree"
    >
      <Section
        title={translate('pod.lineage.tree.upstream', 'Upstream')}
        rows={up}
        more={props.graph.moreUpstream[props.graph.focus] ?? 0}
        selectedNodeId={props.selectedNodeId}
        onSelect={props.onSelect}
        onOpen={props.onOpen}
      />
      <Section
        title={translate('pod.lineage.tree.downstream', 'Downstream')}
        rows={down}
        more={props.graph.moreDownstream[props.graph.focus] ?? 0}
        selectedNodeId={props.selectedNodeId}
        onSelect={props.onSelect}
        onOpen={props.onOpen}
      />
    </div>
  )
}
