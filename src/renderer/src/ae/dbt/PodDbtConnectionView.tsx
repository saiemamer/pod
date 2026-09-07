import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { DbtContextSummary } from '../../../../shared/ae/dbt-types'
import { podDbtErrorMessage } from './pod-dbt-run-target'

type PodDbtConnectionViewProps = {
  fileId: string
  filePath: string
  project: DbtContextSummary | undefined
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 break-all font-mono">{children}</div>
    </div>
  )
}

/** Pod: what dbt will be run with. Names and paths only; no env values reach the renderer. */
export function PodDbtConnectionView({
  fileId,
  filePath,
  project
}: PodDbtConnectionViewProps): React.JSX.Element {
  const loadAeDbtProject = useAppStore((state) => state.loadAeDbtProject)
  const [parseState, setParseState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [parseMessage, setParseMessage] = useState('')
  useEffect(() => {
    if (!project) {
      void loadAeDbtProject(fileId, filePath)
    }
  }, [fileId, filePath, loadAeDbtProject, project])

  const parse = async (): Promise<void> => {
    setParseState('running')
    try {
      const result = await window.api.ae.dbt.parse({ path: filePath })
      setParseState('done')
      setParseMessage(
        translate('pod.dbt.connection.parsed', '{{count}} nodes in {{seconds}}s', {
          count: String(result.manifest.nodeCount ?? 0),
          seconds: String(Math.round(result.durationMs / 1000))
        })
      )
      await loadAeDbtProject(fileId, filePath)
    } catch (error) {
      setParseState('error')
      setParseMessage(podDbtErrorMessage(error))
    }
  }

  if (!project) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {translate('pod.dbt.connection.loading', 'Resolving the dbt project…')}
      </div>
    )
  }
  const { manifest } = project
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-auto scrollbar-sleek p-3">
      <Row label={translate('pod.dbt.connection.project', 'Project')}>
        {project.project.name} · {project.project.projectDir}
      </Row>
      <Row label={translate('pod.dbt.connection.profile', 'Profile / target')}>
        {project.project.profile ?? '—'} /{' '}
        {project.target ?? translate('pod.dbt.connection.profileDefault', 'profile default')}
      </Row>
      <Row label={translate('pod.dbt.connection.profilesDir', 'Profiles dir')}>
        {project.profiles.dir ?? translate('pod.dbt.connection.resolvedByDbt', 'resolved by dbt')}{' '}
        <span className="text-muted-foreground">({project.profiles.source})</span>
      </Row>
      <Row label={translate('pod.dbt.connection.binary', 'dbt binary')}>
        {project.binary ? (
          <>
            {project.binary.path}{' '}
            <span className="text-muted-foreground">({project.binary.source})</span>
          </>
        ) : (
          <span className="text-destructive">
            {translate(
              'pod.dbt.connection.noBinary',
              'not found; set it in Settings › Analytics Tools'
            )}
          </span>
        )}
      </Row>
      <Row label={translate('pod.dbt.connection.envFiles', 'Env files')}>
        {project.envFiles.length > 0 ? project.envFiles.join(', ') : '—'}
      </Row>
      <Row label={translate('pod.dbt.connection.domain', 'Domain')}>{project.domainId ?? '—'}</Row>
      <Row label={translate('pod.dbt.connection.manifest', 'Manifest')}>
        {manifest.exists
          ? translate(
              'pod.dbt.connection.manifestState',
              '{{count}} nodes, dbt {{version}}, generated {{at}}',
              {
                count: String(manifest.nodeCount ?? 0),
                version: manifest.dbtVersion ?? '?',
                at: manifest.generatedAt ?? '?'
              }
            )
          : translate('pod.dbt.connection.noManifest', 'none yet')}
      </Row>
      <div className="mt-1 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={parseState === 'running'}
          onClick={() => void parse()}
        >
          {parseState === 'running'
            ? translate('pod.dbt.connection.parsing', 'Parsing…')
            : translate('pod.dbt.connection.parse', 'dbt parse')}
        </Button>
        {parseMessage && (
          <span
            className={`text-[11px] ${parseState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {parseMessage}
          </span>
        )}
      </div>
    </div>
  )
}
