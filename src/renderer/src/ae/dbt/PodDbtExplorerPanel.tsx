import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Database, GitFork, Loader2, RefreshCw, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { joinPath } from '@/lib/path'
import { useActiveWorktree } from '@/store/selectors'
import type { DbtCatalogTree } from '../../../../shared/ae/dbt-graph-types'
import {
  defaultExpandedRows,
  flattenCatalogTree,
  type PodExplorerRow
} from './pod-dbt-explorer-tree'
import { openPodDbtFile, openPodDbtLineageFor, type PodDbtOpenTarget } from './pod-dbt-open-file'
import { podDbtErrorMessage } from './pod-dbt-run-target'

/**
 * Pod: the Database tab of the right sidebar. Reads target/catalog.json of the dbt
 * project in the active worktree: database, schema, relation, column, with types.
 */
export default function PodDbtExplorerPanel(): React.JSX.Element {
  const worktree = useActiveWorktree()
  const worktreePath = worktree?.path ?? null
  const worktreeId = worktree?.id ?? null
  const [tree, setTree] = useState<DbtCatalogTree | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const api = window.api?.ae?.dbt
    if (!api || !worktreePath) {
      setTree(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const project = await api.project({ path: worktreePath })
        const next = await api.catalogTree({ path: worktreePath })
        if (cancelled) {
          return
        }
        setProjectName(project.project.name)
        setTree(next)
        setExpanded((current) => (current.size > 0 ? current : defaultExpandedRows(next)))
      } catch (cause) {
        if (!cancelled) {
          setTree(null)
          setError(podDbtErrorMessage(cause))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [worktreePath, reloadKey])

  const rows = useMemo(
    () => (tree ? flattenCatalogTree(tree, expanded, filter) : []),
    [tree, expanded, filter]
  )

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const refreshCatalog = async (): Promise<void> => {
    const api = window.api?.ae?.dbt
    if (!api || !worktreePath) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.ensureCatalog({ path: worktreePath, force: true })
      setReloadKey((key) => key + 1)
    } catch (cause) {
      setError(podDbtErrorMessage(cause))
      setLoading(false)
    }
  }

  const targetFor = (row: PodExplorerRow): PodDbtOpenTarget | null => {
    if (!row.relation?.path || !tree || !worktreeId) {
      return null
    }
    return {
      worktreeId,
      worktreePath,
      filePath: joinPath(tree.projectDir, row.relation.path)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pod-dbt-explorer">
      <div className="flex h-8 min-h-8 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {translate('pod.dbt.explorer.title', 'Database')}
          {projectName && <span className="text-muted-foreground"> · {projectName}</span>}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate('pod.dbt.explorer.refresh', 'Refresh catalog')}
              disabled={loading || !worktreePath}
              onClick={() => void refreshCatalog()}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('pod.dbt.explorer.refresh', 'Refresh catalog')}
          </TooltipContent>
        </Tooltip>
      </div>
      {tree?.exists && (
        <div className="border-b border-border/60 px-2 py-1">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={translate('pod.dbt.explorer.filter', 'Filter relations and columns')}
            aria-label={translate('pod.dbt.explorer.filter', 'Filter relations and columns')}
            className="h-6 text-xs"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek py-1">
        {!worktreePath && (
          <Empty
            text={translate(
              'pod.dbt.explorer.noWorktree',
              'Open a worktree to browse its warehouse.'
            )}
          />
        )}
        {worktreePath && error && <Empty text={error} destructive />}
        {worktreePath && !error && tree && !tree.exists && (
          <Empty text={translate('pod.dbt.explorer.noCatalog', 'No catalog yet for this project.')}>
            <Button type="button" variant="outline" size="xs" onClick={() => void refreshCatalog()}>
              {translate('pod.dbt.explorer.generate', 'Generate catalog')}
            </Button>
          </Empty>
        )}
        {rows.map((row) => (
          <ExplorerRow
            key={row.id}
            row={row}
            onToggle={toggle}
            onOpen={() => {
              const target = targetFor(row)
              if (target) {
                openPodDbtFile(target)
              }
            }}
            onLineage={() => {
              const target = targetFor(row)
              if (target) {
                openPodDbtLineageFor(target)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}

function Empty({
  text,
  destructive,
  children
}: {
  text: string
  destructive?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-2 text-xs">
      <span className={destructive ? 'text-destructive' : 'text-muted-foreground'}>{text}</span>
      {children}
    </div>
  )
}

function ExplorerRow({
  row,
  onToggle,
  onOpen,
  onLineage
}: {
  row: PodExplorerRow
  onToggle: (id: string) => void
  onOpen: () => void
  onLineage: () => void
}): React.JSX.Element {
  const canOpen = row.kind === 'relation' && Boolean(row.relation?.path)
  return (
    <div
      className="group flex h-6 items-center gap-1 pr-2 text-xs hover:bg-accent hover:text-accent-foreground"
      style={{ paddingLeft: 6 + row.depth * 12 }}
      data-testid={`pod-dbt-explorer-${row.kind}`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={() => (row.expandable ? onToggle(row.id) : canOpen && onOpen())}
        onDoubleClick={() => canOpen && onOpen()}
      >
        {row.expandable ? (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              row.expanded && 'rotate-90'
            )}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        {row.kind === 'database' && (
          <Database className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {row.kind === 'relation' && <Table2 className="size-3.5 shrink-0 text-muted-foreground" />}
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            row.kind === 'column' && 'font-mono text-[11px]'
          )}
        >
          {row.label}
        </span>
        {row.meta && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{row.meta}</span>
        )}
      </button>
      {/* Why a fixed slot: every row reserves the action's width, so the right-hand
          column lines up whether or not the row can show lineage. */}
      <span className="flex w-6 shrink-0 justify-center">
        {canOpen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={translate('pod.dbt.explorer.lineage', 'Show lineage')}
                onClick={onLineage}
              >
                <GitFork />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {translate('pod.dbt.explorer.lineage', 'Show lineage')}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </div>
  )
}
