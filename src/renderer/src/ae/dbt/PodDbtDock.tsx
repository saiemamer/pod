import { Suspense, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Loader2, Play, X } from 'lucide-react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { detectLanguage } from '@/lib/language-detect'
import { JINJA_SQL_LANGUAGE_ID } from '@/lib/monaco-languages/register-jinja-sql'
import {
  clampPodDbtDockHeight,
  POD_DBT_DOCK_HEIGHT_DEFAULT,
  type PodDbtDockView,
  type PodDbtResultState
} from '@/store/slices/ae-dbt-results'
import { PodDbtConnectionView } from './PodDbtConnectionView'
import { PodDbtResultsGrid } from './PodDbtResultsGrid'
import { ensurePodDbtLanguageClient } from './dbt-lsp-client'
import { startPodDbtRun } from './pod-dbt-run'
import { podDbtErrorMessage } from './pod-dbt-run-target'
import { usePodDbtShortcuts } from './use-pod-dbt-shortcuts'

// Why lazy: React Flow and dagre only load for editors that open the Lineage tab.
const PodDbtLineageView = lazy(() => import('@/ae/lineage/PodDbtLineageView'))

type PodDbtDockProps = {
  activeFile: { id: string; filePath: string; language: string }
}

function statusText(state: PodDbtResultState): string {
  if (state.status === 'running') {
    return translate('pod.dbt.dock.running', 'Running {{label}}…', {
      label: state.label
    })
  }
  if (state.status === 'error') {
    return state.error ?? translate('pod.dbt.dock.failed', 'dbt failed')
  }
  const seconds = (ms: number): string => `${Math.max(1, Math.round(ms / 1000))}s`
  if (state.kind === 'compile' && state.compile) {
    return translate('pod.dbt.dock.compiled', 'Compiled {{label}} in {{seconds}}', {
      label: state.label,
      seconds: seconds(state.compile.durationMs)
    })
  }
  if (state.show) {
    const target = state.show.target ? `, ${state.show.target}` : ''
    return translate(
      'pod.dbt.dock.rows',
      '{{label}}: {{rows}} rows (limit {{limit}}{{target}}, {{seconds}})',
      {
        label: state.label,
        rows: String(state.show.rowCount),
        limit: String(state.show.limit),
        target,
        seconds: seconds(state.show.durationMs)
      }
    )
  }
  return state.label
}

/**
 * Pod: results dock under a Jinja SQL editor. Appears after the first Cmd+Enter or
 * Cmd+Shift+Enter in that editor and stays with the file until closed.
 */
export function PodDbtDock({ activeFile }: PodDbtDockProps): React.JSX.Element | null {
  const isJinjaSql =
    activeFile.language === JINJA_SQL_LANGUAGE_ID ||
    detectLanguage(activeFile.filePath) === JINJA_SQL_LANGUAGE_ID
  // Why optional: the edit surface's tests mount it with a partial store.
  const state = useAppStore((store) => store.aeDbtResults?.[activeFile.id])
  const setAeDbtView = useAppStore((store) => store.setAeDbtView)
  const toggleAeDbtCollapsed = useAppStore((store) => store.toggleAeDbtCollapsed)
  const closeAeDbtResults = useAppStore((store) => store.closeAeDbtResults)
  const dockHeight = useAppStore((store) => store.aeDbtDockHeight ?? POD_DBT_DOCK_HEIGHT_DEFAULT)
  const setAeDbtDockHeight = useAppStore((store) => store.setAeDbtDockHeight)
  const runShortcut = useShortcutLabel('dbt.runSelection')
  usePodDbtProjectWarmup(isJinjaSql ? activeFile.filePath : null)
  // Why a pane ref: the shortcut fires only when focus is in this pane's editor, and the
  // dock is not mounted until the first run, so the ref is taken from a zero-size anchor.
  const anchorRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    paneRef.current = anchorRef.current?.parentElement ?? null
  })
  usePodDbtShortcuts(isJinjaSql ? activeFile : null, paneRef)
  if (!isJinjaSql) {
    return null
  }
  if (!state) {
    return <div ref={anchorRef} hidden />
  }
  const exportCsv = async (columns: string[], rows: unknown[][]): Promise<void> => {
    try {
      const result = await window.api.ae.dbt.exportCsv({
        path: activeFile.filePath,
        label: state.label,
        columns,
        rows
      })
      toast.success(
        translate('pod.dbt.grid.exported', 'Wrote {{rows}} rows to {{file}}', {
          rows: String(result.rowCount),
          file: result.file
        })
      )
    } catch (error) {
      toast.error(podDbtErrorMessage(error))
    }
  }
  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = dockHeight
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      // Why upward-positive: the handle sits on the dock's top edge, so dragging up grows it.
      setAeDbtDockHeight(
        clampPodDbtDockHeight(startHeight + (startY - move.clientY), window.innerHeight)
      )
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }
  const body = (): React.ReactNode => {
    if (state.view === 'lineage') {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <PodDbtLineageView fileId={activeFile.id} filePath={activeFile.filePath} />
        </Suspense>
      )
    }
    if (state.view === 'connection') {
      return (
        <PodDbtConnectionView
          fileId={activeFile.id}
          filePath={activeFile.filePath}
          project={state.project}
        />
      )
    }
    if (state.status === 'error' && state.error) {
      return (
        <pre className="h-full overflow-auto scrollbar-editor whitespace-pre-wrap p-3 font-mono text-xs text-destructive">
          {state.error}
        </pre>
      )
    }
    if (state.view === 'compiled') {
      return state.compile ? (
        <pre className="h-full overflow-auto scrollbar-editor p-3 font-mono text-xs text-foreground">
          {state.compile.sql}
        </pre>
      ) : (
        <div className="p-3 text-xs text-muted-foreground">
          {state.status === 'running'
            ? translate('pod.dbt.dock.compiling', 'Compiling…')
            : translate(
                'pod.dbt.dock.compileHint',
                'Press ⌘⇧Enter to compile the selection or the model.'
              )}
        </div>
      )
    }
    if (state.show) {
      return (
        <PodDbtResultsGrid
          columns={state.show.columns}
          rows={state.show.rows}
          onExport={exportCsv}
        />
      )
    }
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {state.status === 'running' ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          translate('pod.dbt.dock.runHint', 'Press ⌘Enter to run the selection or the model.')
        )}
      </div>
    )
  }
  return (
    <div
      ref={anchorRef}
      data-testid="pod-dbt-dock"
      className="relative flex shrink-0 flex-col border-t border-border/60 bg-background"
      style={{ height: state.collapsed ? undefined : dockHeight }}
    >
      {!state.collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={translate('pod.dbt.dock.resize', 'Resize results')}
          data-testid="pod-dbt-dock-handle"
          className="absolute -top-1 left-0 z-20 h-2 w-full cursor-row-resize hover:bg-primary/30"
          onPointerDown={startDrag}
        />
      )}
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border px-2">
        <Tabs
          value={state.view}
          onValueChange={(value) => setAeDbtView(activeFile.id, value as PodDbtDockView)}
        >
          {/* Why line tabs: the pill read as a floating control next to the plain
              toolbar the Lineage tab adds below; underlined text sits on the same grid. */}
          <TabsList variant="line" className="h-7 gap-0 p-0">
            {(
              [
                ['table', translate('pod.dbt.dock.table', 'Table')],
                ['compiled', translate('pod.dbt.dock.compiled.tab', 'Compiled')],
                ['lineage', translate('pod.dbt.dock.lineage', 'Lineage')],
                ['connection', translate('pod.dbt.dock.connection', 'Connection')]
              ] as const
            ).map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-full px-2 text-[11px] font-medium group-data-[orientation=horizontal]/tabs:after:inset-x-2 group-data-[orientation=horizontal]/tabs:after:bottom-[-2px]"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span
          className={`min-w-0 flex-1 truncate text-xs ${
            state.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
          }`}
          title={statusText(state)}
        >
          {state.status === 'running' && (
            <Loader2 className="mr-1 inline size-3 animate-spin align-[-2px]" />
          )}
          {statusText(state)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('pod.dbt.dock.run', 'Run selection or model')}
          title={`${translate('pod.dbt.dock.run', 'Run selection or model')} (${runShortcut})`}
          disabled={state.status === 'running'}
          onClick={() => void startPodDbtRun(activeFile, 'show')}
        >
          <Play />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('pod.dbt.dock.collapse', 'Collapse results')}
          onClick={() => toggleAeDbtCollapsed(activeFile.id)}
        >
          {state.collapsed ? <ChevronUp /> : <ChevronDown />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('pod.dbt.dock.close', 'Close results')}
          onClick={() => closeAeDbtResults(activeFile.id)}
        >
          <X />
        </Button>
      </div>
      {!state.collapsed && (
        // Why dim: the previous answer stays visible while a rerun is in flight, so mark it stale.
        <div className={`min-h-0 flex-1 ${state.status === 'running' ? 'opacity-60' : ''}`}>
          {body()}
        </div>
      )}
    </div>
  )
}

/**
 * Once per Jinja SQL file: start the language client and, when parseOnLoad is on, bring
 * the manifest and catalog up to date. Main dedupes the catalog run per project.
 */
function usePodDbtProjectWarmup(filePath: string | null): void {
  useEffect(() => {
    if (!filePath || typeof window === 'undefined' || !window.api?.ae?.dbt?.lsp) {
      return
    }
    void ensurePodDbtLanguageClient()
    void window.api.ae.dbt.ensureCatalog({ path: filePath }).catch(() => undefined)
  }, [filePath])
}
