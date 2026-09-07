import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Loader2, Play, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { detectLanguage } from '@/lib/language-detect'
import { JINJA_SQL_LANGUAGE_ID } from '@/lib/monaco-languages/register-jinja-sql'
import type { PodDbtDockView, PodDbtResultState } from '@/store/slices/ae-dbt-results'
import { PodDbtConnectionView } from './PodDbtConnectionView'
import { PodDbtResultsGrid } from './PodDbtResultsGrid'
import { startPodDbtRun } from './pod-dbt-run'
import { usePodDbtShortcuts } from './use-pod-dbt-shortcuts'

type PodDbtDockProps = {
  activeFile: { id: string; filePath: string; language: string }
}

const DOCK_HEIGHT_PX = 288

function statusText(state: PodDbtResultState): string {
  if (state.status === 'running') {
    return translate('pod.dbt.dock.running', 'Running {{label}}…', { label: state.label })
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
  const runShortcut = useShortcutLabel('dbt.runSelection')
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
  const body = (): React.ReactNode => {
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
      return <PodDbtResultsGrid columns={state.show.columns} rows={state.show.rows} />
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
      className="flex shrink-0 flex-col border-t border-border/60 bg-background"
      style={{ height: state.collapsed ? undefined : DOCK_HEIGHT_PX }}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <Tabs
          value={state.view}
          onValueChange={(value) => setAeDbtView(activeFile.id, value as PodDbtDockView)}
        >
          <TabsList className="h-6">
            <TabsTrigger value="table" className="h-5 px-2 text-[11px]">
              {translate('pod.dbt.dock.table', 'Table')}
            </TabsTrigger>
            <TabsTrigger value="compiled" className="h-5 px-2 text-[11px]">
              {translate('pod.dbt.dock.compiled.tab', 'Compiled')}
            </TabsTrigger>
            <TabsTrigger value="connection" className="h-5 px-2 text-[11px]">
              {translate('pod.dbt.dock.connection', 'Connection')}
            </TabsTrigger>
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
