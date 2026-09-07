import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { PodDbtGridToolbar } from './PodDbtGridToolbar'
import {
  clampPodDbtColumnWidth,
  exportablePodDbtRows,
  nextPodDbtSort,
  togglePodDbtHiddenColumn,
  visiblePodDbtRows,
  type PodDbtSort
} from './pod-dbt-grid-state'

type PodDbtResultsGridProps = {
  columns: string[]
  rows: unknown[][]
  /** Receives the shown columns and rows; absent when export is not possible (no project). */
  onExport?: (columns: string[], rows: unknown[][]) => Promise<void>
}

const ROW_HEIGHT = 26
const OVERSCAN = 12
const MIN_COL_PX = 80
const MAX_COL_PX = 320
const ROW_NUMBER_COL_PX = 44
const CHAR_PX = 7

export function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

/**
 * Pod: `dbt show` rows. Same virtualised CSS-grid layout as CsvViewer (absolutely
 * positioned rows break a <table>'s column sync), with typed cells: NULL is dimmed,
 * numbers sit right, and the column list comes from the query rather than a header row.
 * Sort, search, hidden columns and widths are local: they reset with the next run.
 */
export function PodDbtResultsGrid({
  columns,
  rows,
  onExport
}: PodDbtResultsGridProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sort, setSort] = useState<PodDbtSort>(null)
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState<Set<number>>(() => new Set())
  const [widthOverrides, setWidthOverrides] = useState<Record<number, number>>({})
  const [exporting, setExporting] = useState(false)
  const autoWidths = useMemo(() => {
    const widths = columns.map((column) =>
      Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, column.length * CHAR_PX + 24))
    )
    // Why sample: 500 rows is the cap, but sizing on the first 200 keeps this cheap.
    for (const row of rows.slice(0, 200)) {
      row.forEach((value, index) => {
        const width = Math.min(MAX_COL_PX, cellText(value).length * CHAR_PX + 24)
        if (width > (widths[index] ?? 0)) {
          widths[index] = width
        }
      })
    }
    return widths
  }, [columns, rows])
  const shownColumns = useMemo(
    () => columns.map((_, index) => index).filter((index) => !hidden.has(index)),
    [columns, hidden]
  )
  const order = useMemo(
    () => visiblePodDbtRows(rows, { search, sort, hiddenColumns: hidden }),
    [rows, search, sort, hidden]
  )
  const widthOf = (index: number): number =>
    widthOverrides[index] ?? autoWidths[index] ?? MIN_COL_PX
  const gridTemplate = `${ROW_NUMBER_COL_PX}px ${shownColumns.map((i) => `${widthOf(i)}px`).join(' ')}`
  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => order[index] ?? index
  })

  const startResize = (index: number, event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widthOf(index)
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      setWidthOverrides((current) => ({
        ...current,
        [index]: clampPodDbtColumnWidth(startWidth + move.clientX - startX)
      }))
    }
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  const exportRows = onExport
    ? async (): Promise<void> => {
        setExporting(true)
        try {
          const shown = exportablePodDbtRows(columns, rows, order, hidden)
          await onExport(shown.columns, shown.rows)
        } finally {
          setExporting(false)
        }
      }
    : null

  if (columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {translate('pod.dbt.grid.empty', 'The query returned no rows.')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PodDbtGridToolbar
        columns={columns}
        hiddenColumns={hidden}
        search={search}
        shownRows={order.length}
        totalRows={rows.length}
        exporting={exporting}
        onSearch={setSearch}
        onToggleColumn={(index) => setHidden((current) => togglePodDbtHiddenColumn(current, index))}
        onShowAllColumns={() => setHidden(new Set())}
        onExport={exportRows}
      />
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto scrollbar-editor font-mono text-xs"
      >
        <div
          role="table"
          aria-rowcount={order.length + 1}
          aria-colcount={shownColumns.length + 1}
          className="inline-block min-w-full"
          style={{ width: 'max-content' }}
        >
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-10 grid bg-muted/90 backdrop-blur"
            style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
          >
            <div
              role="columnheader"
              className="sticky left-0 z-20 flex items-center justify-end border-b border-r border-border/60 bg-muted/90 px-2 text-[10px] font-normal text-muted-foreground"
            >
              #
            </div>
            {shownColumns.map((index) => {
              const column = columns[index]
              const sorted = sort?.column === index ? sort.direction : null
              return (
                <div
                  role="columnheader"
                  aria-sort={
                    sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                  }
                  key={`${column}-${index}`}
                  className="relative flex items-center overflow-hidden border-b border-r border-border/60 font-medium text-foreground"
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left hover:bg-accent/40"
                    title={translate('pod.dbt.grid.sortHint', 'Sort by {{column}}', { column })}
                    onClick={() => setSort((current) => nextPodDbtSort(current, index))}
                  >
                    <span className="truncate">{column}</span>
                    {sorted === 'asc' && <ArrowUp className="size-3 shrink-0" />}
                    {sorted === 'desc' && <ArrowDown className="size-3 shrink-0" />}
                  </button>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={translate('pod.dbt.grid.resize', 'Resize {{column}}', { column })}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                    onPointerDown={(event) => startResize(index, event)}
                  />
                </div>
              )
            })}
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const rowIndex = order[virtualRow.index] ?? 0
              const row = rows[rowIndex] ?? []
              return (
                <div
                  role="row"
                  aria-rowindex={virtualRow.index + 2}
                  key={virtualRow.key}
                  className="group grid hover:bg-accent/40"
                  style={{
                    gridTemplateColumns: gridTemplate,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <div
                    role="rowheader"
                    className="sticky left-0 z-[5] flex items-center justify-end border-b border-r border-border/40 bg-background/95 px-2 text-[10px] text-muted-foreground group-hover:bg-accent/40"
                  >
                    {rowIndex + 1}
                  </div>
                  {shownColumns.map((index) => {
                    const value = row[index]
                    const isNull = value === null || value === undefined
                    const text = cellText(value)
                    return (
                      <div
                        role="cell"
                        key={`${columns[index]}#${index}`}
                        className={`flex items-center overflow-hidden border-b border-r border-border/40 px-2 ${
                          typeof value === 'number' ? 'justify-end' : ''
                        } ${isNull ? 'italic text-muted-foreground' : 'text-foreground'}`}
                        title={text}
                      >
                        <span className="truncate">{text}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
