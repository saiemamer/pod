import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { translate } from '@/i18n/i18n'

type PodDbtResultsGridProps = {
  columns: string[]
  rows: unknown[][]
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
 */
export function PodDbtResultsGrid({ columns, rows }: PodDbtResultsGridProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnWidths = useMemo(() => {
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
  const gridTemplate = `${ROW_NUMBER_COL_PX}px ${columnWidths.map((w) => `${w}px`).join(' ')}`
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => index
  })

  if (columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {translate('pod.dbt.grid.empty', 'The query returned no rows.')}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="relative h-full min-h-0 overflow-auto scrollbar-editor font-mono text-xs"
    >
      <div
        role="table"
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length + 1}
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
          {columns.map((column, index) => (
            <div
              role="columnheader"
              key={`${column}-${index}`}
              className="flex items-center overflow-hidden border-b border-r border-border/60 px-2 font-medium text-foreground"
            >
              <span className="truncate" title={column}>
                {column}
              </span>
            </div>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index] ?? []
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
                  {virtualRow.index + 1}
                </div>
                {columns.map((column, index) => {
                  const value = row[index]
                  const isNull = value === null || value === undefined
                  const text = cellText(value)
                  return (
                    <div
                      role="cell"
                      key={`${column}#${index}`}
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
  )
}
