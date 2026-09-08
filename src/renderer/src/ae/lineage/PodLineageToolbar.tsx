import { memo } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
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
import type { LineageKind } from './lineage-canvas-state'

export type PodLineageToolbarProps = {
  truncated: boolean
  upstreamDepth: number
  downstreamDepth: number
  showColumns: boolean
  showTree: boolean
  loading: boolean
  engine: DbtLineageEngineStatus | null
  kinds: LineageKind[]
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

function Stepper({
  label,
  value,
  lessLabel,
  moreLabel,
  testId,
  onChange
}: {
  label: string
  value: string
  lessLabel: string
  moreLabel: string
  testId: string
  onChange: (delta: number) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
      <span className="mr-0.5">{label}</span>
      <IconAction label={lessLabel} onClick={() => onChange(-1)}>
        <Minus />
      </IconAction>
      <span
        className="min-w-6 text-center font-mono tabular-nums text-foreground"
        data-testid={testId}
      >
        {value}
      </span>
      <IconAction label={moreLabel} onClick={() => onChange(1)}>
        <Plus />
      </IconAction>
    </div>
  )
}

/** One step of the − / + buttons; pinch and wheel stay continuous. */
export const LINEAGE_ZOOM_STEP = 1.1

/**
 * Zoom out, percentage, zoom in. Its own component because the percentage changes on
 * every wheel frame and the rest of the toolbar need not re-render for it.
 */
function ZoomStepper(): React.JSX.Element {
  const { zoomTo, getZoom } = useReactFlow()
  const zoom = useStore((state) => state.transform[2])
  return (
    <Stepper
      label=""
      value={`${Math.round(zoom * 100)}%`}
      lessLabel={translate('pod.lineage.toolbar.zoomOut', 'Zoom out')}
      moreLabel={translate('pod.lineage.toolbar.zoomIn', 'Zoom in')}
      testId="pod-lineage-zoom"
      // Why 1.1: React Flow's zoomIn and zoomOut step by 1.2, which jumps 47 % to 57 %;
      // ten percent steps read as one notch. zoomTo clamps to the canvas's zoom range.
      onChange={(delta) =>
        void zoomTo(delta > 0 ? getZoom() * LINEAGE_ZOOM_STEP : getZoom() / LINEAGE_ZOOM_STEP, {
          duration: 150
        })
      }
    />
  )
}

function kindLabel(kind: LineageKind): string {
  switch (kind) {
    case 'source':
      return translate('pod.lineage.kind.source', 'source')
    case 'view':
      return translate('pod.lineage.kind.view', 'view')
    case 'table':
      return translate('pod.lineage.kind.table', 'table')
    case 'incremental':
      return translate('pod.lineage.kind.incremental', 'incremental')
    case 'seed':
      return translate('pod.lineage.kind.seed', 'seed')
    case 'snapshot':
      return translate('pod.lineage.kind.snapshot', 'snapshot')
    case 'ephemeral':
      return translate('pod.lineage.kind.ephemeral', 'ephemeral')
    default:
      return translate('pod.lineage.kind.other', 'other')
  }
}

/** Second row of the dock on the Lineage tab: depth, view toggles, zoom, legend, engine. */
function PodLineageToolbarComponent(props: PodLineageToolbarProps): React.JSX.Element {
  const { fitView } = useReactFlow()
  // Why short: the toolbar shares one row with the legend; the version and the reason
  // for a fallback live in the tooltip and on the Connection tab.
  const engineText = !props.engine
    ? ''
    : props.engine.engine === 'sqlglot'
      ? 'sqlglot'
      : translate('pod.lineage.toolbar.nameMatch', 'name match')
  const engineTitle = !props.engine
    ? ''
    : props.engine.engine === 'sqlglot'
      ? `sqlglot ${props.engine.sqlglotVersion ?? ''} · ${props.engine.python ?? ''}`.trim()
      : (props.engine.note ?? '')
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border pr-2 pl-4 text-xs">
      <Stepper
        label={translate('pod.lineage.toolbar.upstream', 'Upstream')}
        value={String(props.upstreamDepth)}
        lessLabel={translate('pod.lineage.toolbar.less', 'One level less')}
        moreLabel={translate('pod.lineage.toolbar.more', 'One level more')}
        testId="pod-lineage-depth-up"
        onChange={(delta) => props.onDepthChange('up', delta)}
      />
      <Stepper
        label={translate('pod.lineage.toolbar.downstream', 'Downstream')}
        value={String(props.downstreamDepth)}
        lessLabel={translate('pod.lineage.toolbar.less', 'One level less')}
        moreLabel={translate('pod.lineage.toolbar.more', 'One level more')}
        testId="pod-lineage-depth-down"
        onChange={(delta) => props.onDepthChange('down', delta)}
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
          onClick={() => void fitView({ padding: 0.15, duration: 200 })}
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
      <ZoomStepper />
      {props.truncated && (
        <span className="text-[11px] text-muted-foreground">
          {translate('pod.lineage.toolbar.truncated', 'cut at the node cap')}
        </span>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div
          className="flex min-w-0 items-center gap-2 overflow-hidden"
          data-testid="pod-lineage-legend"
        >
          {props.kinds.map((kind) => (
            <span
              key={kind}
              className="flex items-center gap-1 whitespace-nowrap text-[10px] text-muted-foreground"
            >
              <span
                className="size-2 rounded-full"
                style={{ background: `var(--pod-lineage-${kind})` }}
              />
              {kindLabel(kind)}
            </span>
          ))}
        </div>
        <span
          className="shrink-0 text-[10px] text-muted-foreground"
          data-testid="pod-lineage-engine"
          title={engineTitle}
        >
          {engineText}
        </span>
      </div>
    </div>
  )
}

// Why memo: the view re-renders on every column click, and seven tooltips plus the
// legend are a visible share of that pass while none of their props changed.
export const PodLineageToolbar = memo(PodLineageToolbarComponent)
