import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import type { DbtPrepareState } from '../../../../shared/ae/dbt-readiness-types'
import { podDbtErrorMessage } from './pod-dbt-run-target'

type PodDbtReadinessNoticeProps = {
  filePath: string
  /** Called once the copy becomes ready, so the caller can load what it wanted. */
  onReady: () => void
  /** What the caller shows when the project is ready and the problem is something else. */
  children: React.ReactNode
}

/**
 * Pod: says in plain words what a copy of a dbt project still lacks (packages, a
 * manifest), shows preparation that is already running, and offers one button that
 * installs packages and parses. dbt's own text stays behind "Details".
 */
export function PodDbtReadinessNotice({
  filePath,
  onReady,
  children
}: PodDbtReadinessNoticeProps): React.JSX.Element | null {
  const [state, setState] = useState<DbtPrepareState | null>(null)
  const [checked, setChecked] = useState(false)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const api = window.api?.ae?.dbt
    if (!api) {
      setChecked(true)
      return
    }
    let cancelled = false
    let projectDir: string | null = null
    const off = api.onPrepareEvent((next) => {
      if (!cancelled && next.projectDir === projectDir) {
        setState(next)
        if (next.state === 'done') {
          onReadyRef.current()
        }
      }
    })
    void api
      .readiness({ path: filePath })
      .then((next) => {
        if (!cancelled) {
          projectDir = next.projectDir
          setState(next)
        }
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setChecked(true))
    return () => {
      cancelled = true
      off()
    }
  }, [filePath])

  const prepare = useCallback(async () => {
    const api = window.api?.ae?.dbt
    if (!api) {
      return
    }
    try {
      const next = await api.prepare({ path: filePath })
      setState(next)
      if (next.state === 'done') {
        onReadyRef.current()
      }
    } catch (error) {
      setState((current) =>
        current
          ? {
              ...current,
              state: 'failed',
              failure: { kind: 'packages', details: podDbtErrorMessage(error) }
            }
          : current
      )
    }
  }, [filePath])

  if (!checked) {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  }
  if (!state || (state.readiness.ready && state.state !== 'running')) {
    return <>{children}</>
  }
  const running = state.state === 'running'
  return (
    <div
      className="flex max-w-md flex-col items-center gap-2 text-center text-xs text-muted-foreground"
      data-testid="pod-dbt-readiness"
    >
      <span>{running ? runningText(state) : headline(state)}</span>
      {running ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => void prepare()}
          data-testid="pod-dbt-prepare"
        >
          {state.readiness.packagesInstalled
            ? translate('pod.dbt.ready.parse', 'Build the manifest')
            : translate('pod.dbt.ready.install', 'Install packages and parse')}
        </Button>
      )}
      {!running && state.failure?.details && (
        <Collapsible className="w-full">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="xs">
              {translate('pod.dbt.ready.details', 'Details')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="max-h-40 overflow-auto scrollbar-editor whitespace-pre-wrap rounded border border-border p-2 text-left font-mono text-[11px]">
              {state.failure.details}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function runningText(state: DbtPrepareState): string {
  switch (state.step) {
    case 'packages-reuse':
      return translate('pod.dbt.ready.reusing', 'Copying packages from the main copy…')
    case 'packages-deps':
      return translate('pod.dbt.ready.deps', 'Installing packages…')
    case 'parse':
      return translate('pod.dbt.ready.parsing', 'Building the manifest…')
    case undefined:
      return translate('pod.dbt.ready.preparing', 'Preparing this copy…')
  }
}

function headline(state: DbtPrepareState): string {
  const failure = state.failure
  if (state.state === 'failed' && failure) {
    switch (failure.kind) {
      case 'private-package':
        return failure.tokenVariable
          ? translate(
              'pod.dbt.ready.privateVar',
              'A private package needs a token. Set {{name}} in the repo’s .env file, then try again.',
              { name: failure.tokenVariable }
            )
          : translate(
              'pod.dbt.ready.private',
              'A private package needs a token, and the git host refused access.'
            )
      case 'no-dbt':
        return translate(
          'pod.dbt.ready.noDbt',
          'dbt was not found. Set its path in Settings > Analytics Tools.'
        )
      case 'parse':
        return translate('pod.dbt.ready.parseFailed', 'dbt could not build the manifest.')
      case 'packages':
        return translate('pod.dbt.ready.depsFailed', 'Installing packages failed.')
    }
  }
  const { packagesInstalled, manifest } = state.readiness
  if (!packagesInstalled && !manifest) {
    return translate('pod.dbt.ready.none', 'This copy has no packages and no manifest yet.')
  }
  return packagesInstalled
    ? translate('pod.dbt.ready.noManifest', 'No manifest yet.')
    : translate('pod.dbt.ready.noPackages', 'This copy has no packages yet.')
}
