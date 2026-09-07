import {
  Columns3,
  ListTree,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Shuffle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DbtLineageEngineStatus } from '../../../../shared/ae/dbt-graph-types'

export type PodLineageToolbarProps = {
  focusName: string
  shownNodes: number
  totalNodes: number
  truncated: boolean
  upstreamDepth: number
  downstreamDepth: number
  showColumns: boolean
  showTree: boolean
  loading: boolean
  engine: DbtLineageEngineStatus | null
  onDepthChange: (side: 'up' | 'down', delta: number) => void
  onToggleColumns: () => void
  onToggleTree: () => void
  onArrange: () => void
  onRefresh: () => void
}

function IconAction({
  label,
  onClick,
  pressed,
  children,
  testId
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={pressed}
          data-testid={testId}
          className={cn(pressed && 'bg-accent text-accent-foreground')}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function DepthControl({
  label,
  value,
  side,
  onDepthChange
}: {
  label: string
  value: number
  side: 'up' | 'down'
  onDepthChange: PodLineageToolbarProps['onDepthChange']
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <IconAction
        label={translate('pod.lineage.toolbar.less', 'One level less')}
        onClick={() => onDepthChange(side, -1)}
      >
        <Minus />
      </IconAction>
      <span
        className="w-3 text-center font-mono text-foreground"
        data-testid={`pod-lineage-depth-${side}`}
      >
        {value}
      </span>
      <IconAction
        label={translate('pod.lineage.toolbar.more', 'One level more')}
        onClick={() => onDepthChange(side, 1)}
      >
        <Plus />
      </IconAction>
    </div>
  )
}

export function PodLineageToolbar(props: PodLineageToolbarProps): React.JSX.Element {
  const engineText = !props.engine
    ? ''
    : props.engine.engine === 'sqlglot'
      ? `sqlglot ${props.engine.sqlglotVersion ?? ''}`.trim()
      : translate('pod.lineage.toolbar.nameMatch', 'name matching')
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-b border-border/60 px-2 text-xs">
      <span className="min-w-0 truncate font-medium" title={props.focusName}>
        {props.focusName}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground" data-testid="pod-lineage-count">
        {translate('pod.lineage.toolbar.count', '{{shown}} of {{total}} nodes', {
          shown: String(props.shownNodes),
          total: String(props.totalNodes)
        })}
        {props.truncated &&
          ` · ${translate('pod.lineage.toolbar.truncated', 'cut at the node cap')}`}
      </span>
      <DepthControl
        label={translate('pod.lineage.toolbar.upstream', 'Upstream')}
        value={props.upstreamDepth}
        side="up"
        onDepthChange={props.onDepthChange}
      />
      <DepthControl
        label={translate('pod.lineage.toolbar.downstream', 'Downstream')}
        value={props.downstreamDepth}
        side="down"
        onDepthChange={props.onDepthChange}
      />
      <div className="flex items-center gap-0.5">
        <IconAction
          label={translate('pod.lineage.toolbar.columns', 'Columns')}
          pressed={props.showColumns}
          onClick={props.onToggleColumns}
          testId="pod-lineage-columns"
        >
          <Columns3 />
        </IconAction>
        <IconAction
          label={translate('pod.lineage.toolbar.tree', 'Upstream and downstream list')}
          pressed={props.showTree}
          onClick={props.onToggleTree}
          testId="pod-lineage-tree-toggle"
        >
          <ListTree />
        </IconAction>
        <IconAction
          label={translate('pod.lineage.toolbar.arrange', 'Arrange')}
          onClick={props.onArrange}
        >
          <Shuffle />
        </IconAction>
        <IconAction
          label={translate('pod.lineage.toolbar.fit', 'Fit to view')}
          onClick={props.onArrange}
        >
          <Maximize2 />
        </IconAction>
        <IconAction
          label={translate('pod.lineage.toolbar.refresh', 'Reload from manifest')}
          onClick={props.onRefresh}
        >
          {props.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </IconAction>
      </div>
      <span
        className="ml-auto shrink-0 text-[11px] text-muted-foreground"
        data-testid="pod-lineage-engine"
        title={props.engine?.note}
      >
        {engineText}
      </span>
    </div>
  )
}
