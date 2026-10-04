import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { DbtCatalogRun } from '../../../../shared/ae/dbt-types'

/**
 * Pod: the Database tab's catalog line. Says what Generate catalog does before the first
 * run, how long a run has been going, and the last run's outcome, which main keeps for
 * the session so it survives the tab being closed and reopened.
 */
export function formatPodDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export default function PodDbtCatalogStatus({
  run,
  catalogExists,
  target,
  onGenerate
}: {
  run: DbtCatalogRun | null
  catalogExists: boolean
  target?: string
  onGenerate: () => void
}): React.JSX.Element | null {
  // Why no reset here: the panel keys this component on the run, so a new run closes it.
  const [open, setOpen] = useState(false)

  if (run?.status === 'running') {
    return <CatalogRunning startedAt={run.startedAt} />
  }
  if (run?.status === 'failed' && run.failure) {
    const { failure } = run
    return (
      <Block testId="pod-dbt-catalog-failed">
        <span className="font-medium text-destructive">{failure.title}</span>
        {failure.reason && <span className="text-foreground">{failure.reason}</span>}
        <span className="text-muted-foreground">{failure.hint}</span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="xs" onClick={onGenerate}>
            {translate('pod.dbt.catalog.retry', 'Try again')}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(!open)}>
            {open
              ? translate('pod.dbt.catalog.hideDetails', 'Hide details')
              : translate('pod.dbt.catalog.details', 'Details')}
          </Button>
        </div>
        {open && (
          <pre className="max-h-48 w-full overflow-auto scrollbar-sleek whitespace-pre-wrap rounded-md border border-border bg-muted p-2 font-mono text-[11px] text-foreground">
            {failure.details}
          </pre>
        )}
      </Block>
    )
  }
  if (!catalogExists) {
    return (
      <Block testId="pod-dbt-catalog-empty">
        <span className="text-muted-foreground">
          {target
            ? translate(
                'pod.dbt.catalog.explainTarget',
                'No catalog yet. Generate catalog reads table and column information from the warehouse with the target {{target}}. On a large project it can take a minute or two.',
                { target }
              )
            : translate(
                'pod.dbt.catalog.explain',
                "No catalog yet. Generate catalog reads table and column information from the warehouse with this project's target. On a large project it can take a minute or two."
              )}
        </span>
        <Button type="button" variant="outline" size="xs" onClick={onGenerate}>
          {translate('pod.dbt.explorer.generate', 'Generate catalog')}
        </Button>
      </Block>
    )
  }
  if (run?.status === 'partial' && run.skipped) {
    const { skipped } = run
    return (
      <Block testId="pod-dbt-catalog-partial">
        <span className="text-muted-foreground">
          {skipped.length === 1
            ? translate(
                'pod.dbt.catalog.partialOne',
                'Catalog read in {{duration}}. 1 dataset could not be read and was skipped.',
                { duration: formatPodDuration(run.durationMs ?? 0) }
              )
            : translate(
                'pod.dbt.catalog.partial',
                'Catalog read in {{duration}}. {{skipped}} datasets could not be read and were skipped.',
                {
                  duration: formatPodDuration(run.durationMs ?? 0),
                  skipped: String(skipped.length)
                }
              )}{' '}
          <button
            type="button"
            className="text-foreground underline underline-offset-2"
            onClick={() => setOpen(!open)}
          >
            {open
              ? translate('pod.dbt.catalog.hideSkipped', 'Hide')
              : translate('pod.dbt.catalog.showSkipped', 'Show which')}
          </button>
        </span>
        {open && (
          <ul className="flex w-full flex-col gap-0.5">
            {skipped.map((skip) => (
              <li
                key={skip.dataset ?? skip.message}
                className="truncate font-mono text-[11px] text-muted-foreground"
                title={skip.message}
              >
                {skip.dataset ?? skip.message}
              </li>
            ))}
          </ul>
        )}
      </Block>
    )
  }
  if (run?.status === 'ok') {
    return (
      <Block testId="pod-dbt-catalog-ok">
        <span className="text-muted-foreground">
          {translate('pod.dbt.catalog.ok', 'Catalog read in {{duration}}.', {
            duration: formatPodDuration(run.durationMs ?? 0)
          })}
        </span>
      </Block>
    )
  }
  return null
}

function CatalogRunning({ startedAt }: { startedAt: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <Block testId="pod-dbt-catalog-running">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
        {translate(
          'pod.dbt.catalog.running',
          'Reading tables and columns from the warehouse… {{duration}}',
          { duration: formatPodDuration(now - startedAt) }
        )}
      </span>
    </Block>
  )
}

function Block({
  testId,
  children
}: {
  testId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-start gap-1.5 border-b border-border/60 px-3 py-2 text-xs"
      data-testid={testId}
    >
      {children}
    </div>
  )
}
