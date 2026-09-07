import { Columns3, Download, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'

type PodDbtGridToolbarProps = {
  columns: string[]
  hiddenColumns: ReadonlySet<number>
  search: string
  shownRows: number
  totalRows: number
  exporting: boolean
  onSearch: (value: string) => void
  onToggleColumn: (index: number) => void
  onShowAllColumns: () => void
  onExport: (() => void) | null
}

/** Pod: search, column visibility and CSV export above the results grid. */
export function PodDbtGridToolbar({
  columns,
  hiddenColumns,
  search,
  shownRows,
  totalRows,
  exporting,
  onSearch,
  onToggleColumn,
  onShowAllColumns,
  onExport
}: PodDbtGridToolbarProps): React.JSX.Element {
  // Why: two columns can share a name (select a.id, b.id), so the key carries the position.
  const columnKeys = columns.map((column, index) => `${index}:${column}`)
  const countText =
    shownRows === totalRows
      ? translate('pod.dbt.grid.rowCount', '{{total}} rows', { total: String(totalRows) })
      : translate('pod.dbt.grid.rowCountFiltered', '{{shown}} of {{total}} rows', {
          shown: String(shownRows),
          total: String(totalRows)
        })
  return (
    <div
      data-testid="pod-dbt-grid-toolbar"
      className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 px-2"
    >
      <div className="relative w-56">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={translate('pod.dbt.grid.search', 'Search rows')}
          aria-label={translate('pod.dbt.grid.search', 'Search rows')}
          className="h-6 pl-6 text-xs md:text-xs"
        />
      </div>
      <span className="text-[11px] text-muted-foreground" data-testid="pod-dbt-grid-count">
        {countText}
      </span>
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={translate('pod.dbt.grid.columns', 'Columns')}
            title={translate('pod.dbt.grid.columnsHint', 'Show or hide columns')}
          >
            <Columns3 className="size-3.5" />
            {hiddenColumns.size > 0 && (
              <span className="ml-1 text-[11px]">
                {translate('pod.dbt.grid.hiddenCount', '{{hidden}} hidden', {
                  hidden: String(hiddenColumns.size)
                })}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-auto scrollbar-sleek">
          {hiddenColumns.size > 0 && (
            <DropdownMenuCheckboxItem checked={false} onCheckedChange={onShowAllColumns}>
              {translate('pod.dbt.grid.showAll', 'Show all columns')}
            </DropdownMenuCheckboxItem>
          )}
          {columnKeys.map((key, index) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={!hiddenColumns.has(index)}
              onCheckedChange={() => onToggleColumn(index)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="font-mono text-xs">{columns[index]}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {onExport && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={exporting}
          onClick={onExport}
          aria-label={translate('pod.dbt.grid.export', 'Export CSV')}
          title={translate('pod.dbt.grid.exportHint', 'Write the shown rows to target/ as CSV')}
        >
          <Download className="size-3.5" />
          <span className="ml-1 text-[11px]">{translate('pod.dbt.grid.export', 'Export CSV')}</span>
        </Button>
      )}
    </div>
  )
}
