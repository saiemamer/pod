import { useCallback, useMemo } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openPodDbtFile, podDbtOpenTargetFromEditor } from '@/ae/dbt/pod-dbt-open-file'
import { lineageKindsIn } from './lineage-canvas-state'
import { PodLineageCanvas } from './PodLineageCanvas'
import { PodLineageToolbar } from './PodLineageToolbar'
import { PodLineageTree } from './PodLineageTree'
import { usePodLineageGraph } from './use-pod-lineage-graph'

type PodDbtLineageViewProps = {
  fileId: string
  filePath: string
}

/**
 * Pod: the Lineage tab of the results dock. Loaded lazily, so React Flow and dagre
 * only ship to editors that open it. Owns the React Flow provider so the toolbar's
 * zoom controls and the canvas share one viewport.
 */
export default function PodDbtLineageView({
  fileId,
  filePath
}: PodDbtLineageViewProps): React.JSX.Element {
  const state = usePodLineageGraph(filePath)
  const { graph } = state

  const openNode = useCallback(
    (nodeId: string) => {
      const node = graph?.nodes.find((entry) => entry.uniqueId === nodeId)
      if (!graph || !node?.path) {
        return
      }
      const target = podDbtOpenTargetFromEditor(fileId, graph.projectDir, node.path)
      if (target) {
        openPodDbtFile(target)
      }
    },
    [fileId, graph]
  )
  const kinds = useMemo(() => (graph ? lineageKindsIn(graph.nodes) : []), [graph])
  const { clickColumn, expand } = state
  const onColumnClick = useCallback(
    (nodeId: string, column: string) => void clickColumn(nodeId, column),
    [clickColumn]
  )
  const onExpand = useCallback(
    (nodeId: string, side: 'up' | 'down') => void expand(nodeId, side),
    [expand]
  )

  if (!graph) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
        {state.loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <span className="max-w-md text-center" data-testid="pod-lineage-error">
              {state.error ?? translate('pod.lineage.empty', 'No lineage yet.')}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void state.parseProject()}
            >
              {translate('pod.lineage.parse', 'dbt parse')}
            </Button>
          </>
        )}
      </div>
    )
  }
  const nameMatched = new Set(state.columnResult?.nameMatchedNodes ?? [])
  return (
    <ReactFlowProvider>
      <div className="flex h-full min-h-0 flex-col" data-testid="pod-lineage-view">
        <PodLineageToolbar
          truncated={graph.truncated}
          upstreamDepth={state.upstreamDepth ?? graph.upstreamDepth}
          downstreamDepth={state.downstreamDepth ?? graph.downstreamDepth}
          showColumns={state.showColumns}
          showTree={state.showTree}
          loading={state.loading}
          engine={state.engine}
          kinds={kinds}
          onDepthChange={state.setDepth}
          onToggleColumns={state.toggleColumns}
          onToggleTree={state.toggleTree}
          onArrange={state.arrange}
          onRefresh={state.reload}
        />
        {(state.error || state.columnError) && (
          <div className="shrink-0 border-b border-border px-2 py-1 text-[11px] text-destructive">
            {state.error ?? state.columnError}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {/* Why absolute: React Flow sizes itself from its parent, and a flex child's
              percentage height resolves to auto until the box is positioned. */}
          <div className="relative min-w-0 flex-1">
            <div className="absolute inset-0">
              <PodLineageCanvas
                graph={graph}
                collapse={state.collapse}
                highlight={state.highlight}
                focusColumn={state.focusColumn}
                nameMatchedNodes={nameMatched}
                showColumns={state.showColumns}
                arrangeKey={state.arrangeKey}
                selectedNodeId={state.selectedNodeId}
                onColumnClick={onColumnClick}
                onToggleCollapse={state.toggleCollapse}
                onExpand={onExpand}
                onOpen={openNode}
              />
            </div>
          </div>
          {state.showTree && (
            <PodLineageTree
              graph={graph}
              maxDepth={Math.max(state.upstreamDepth ?? 1, state.downstreamDepth ?? 1, 1) + 8}
              selectedNodeId={state.selectedNodeId}
              onSelect={state.select}
              onOpen={openNode}
            />
          )}
        </div>
      </div>
    </ReactFlowProvider>
  )
}
