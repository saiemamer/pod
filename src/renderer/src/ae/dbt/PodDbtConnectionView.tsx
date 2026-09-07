import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { DbtContextSummary } from '../../../../shared/ae/dbt-types'
import type { DbtLspStatus } from '../../../../shared/ae/dbt-lsp-types'
import type { DbtLineageEngineStatus } from '../../../../shared/ae/dbt-graph-types'
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
  const projectDir = project?.project.projectDir
  const lsp = useAppStore((state) => (projectDir ? state.aeDbtLsp?.[projectDir] : undefined))
  const setAeDbtLspStatus = useAppStore((state) => state.setAeDbtLspStatus)
  const [parseState, setParseState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [parseMessage, setParseMessage] = useState('')
  const [catalogState, setCatalogState] = useState<'idle' | 'running' | 'error'>('idle')
  const [catalogMessage, setCatalogMessage] = useState('')
  const [engine, setEngine] = useState<DbtLineageEngineStatus | null>(null)
  useEffect(() => {
    if (!project) {
      void loadAeDbtProject(fileId, filePath)
    }
  }, [fileId, filePath, loadAeDbtProject, project])
  useEffect(() => {
    if (project) {
      void window.api.ae.dbt
        .lineageEngine({ path: filePath })
        .then(setEngine)
        .catch(() => setEngine(null))
    }
  }, [filePath, project])
  useEffect(() => {
    // Why: the dock may open before any status event arrived; ask once.
    if (project && !lsp) {
      void window.api.ae.dbt.lsp.status({ path: filePath }).then(setAeDbtLspStatus)
    }
  }, [filePath, lsp, project, setAeDbtLspStatus])

  const parse = async (): Promise<void> => {
    setParseState('running')
    try {
      const result = await window.api.ae.dbt.parse({ path: filePath })
      setParseState('done')
      setParseMessage(
        translate('pod.dbt.connection.parsed', '{{nodes}} nodes in {{seconds}}s', {
          nodes: String(result.manifest.nodeCount ?? 0),
          seconds: String(Math.round(result.durationMs / 1000))
        })
      )
      await loadAeDbtProject(fileId, filePath)
    } catch (error) {
      setParseState('error')
      setParseMessage(podDbtErrorMessage(error))
    }
  }

  const refreshCatalog = async (): Promise<void> => {
    setCatalogState('running')
    setCatalogMessage('')
    try {
      const result = await window.api.ae.dbt.ensureCatalog({
        path: filePath,
        force: true
      })
      setCatalogState('idle')
      setCatalogMessage(
        translate('pod.dbt.connection.catalogRefreshed', '{{commands}} in {{seconds}}s', {
          commands: result.commands.join(', '),
          seconds: String(Math.round(result.durationMs / 1000))
        })
      )
      await loadAeDbtProject(fileId, filePath)
    } catch (error) {
      setCatalogState('error')
      setCatalogMessage(podDbtErrorMessage(error))
    }
  }
  const restartLsp = async (): Promise<void> => {
    setAeDbtLspStatus(await window.api.ae.dbt.lsp.restart({ path: filePath }))
  }

  if (!project) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {translate('pod.dbt.connection.loading', 'Resolving the dbt project…')}
      </div>
    )
  }
  const { manifest, catalog } = project
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
              '{{nodes}} nodes, dbt {{version}}, generated {{at}}',
              {
                nodes: String(manifest.nodeCount ?? 0),
                version: manifest.dbtVersion ?? '?',
                at: manifest.generatedAt ?? '?'
              }
            )
          : translate('pod.dbt.connection.noManifest', 'none yet')}
      </Row>
      <Row label={translate('pod.dbt.connection.catalog', 'Catalog')}>
        {catalog.exists
          ? translate('pod.dbt.connection.catalogState', '{{nodes}} relations, generated {{at}}', {
              nodes: String(catalog.nodeCount ?? 0),
              at: catalog.generatedAt ?? '?'
            })
          : project.parseOnLoad
            ? translate('pod.dbt.connection.noCatalogYet', 'none yet; refreshes on open')
            : translate('pod.dbt.connection.noCatalog', 'none; parse on load is off')}
      </Row>
      <Row label={translate('pod.dbt.connection.lsp', 'Language server')}>
        <span data-testid="pod-dbt-lsp-status">{lspText(lsp, project.lspEnabled)}</span>
      </Row>
      <Row label={translate('pod.dbt.connection.lineageEngine', 'Column lineage')}>
        <span data-testid="pod-dbt-lineage-engine">{engineText(engine)}</span>
      </Row>
      <div className="mt-1 flex flex-wrap items-center gap-2">
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
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={catalogState === 'running'}
          onClick={() => void refreshCatalog()}
        >
          {catalogState === 'running'
            ? translate('pod.dbt.connection.catalogRunning', 'Refreshing catalog…')
            : translate('pod.dbt.connection.refreshCatalog', 'Refresh catalog')}
        </Button>
        {catalogMessage && (
          <span
            className={`text-[11px] ${catalogState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {catalogMessage}
          </span>
        )}
        {project.lspEnabled && (
          <Button type="button" variant="outline" size="xs" onClick={() => void restartLsp()}>
            {translate('pod.dbt.connection.restartLsp', 'Restart language server')}
          </Button>
        )}
      </div>
    </div>
  )
}

function engineText(status: DbtLineageEngineStatus | null): string {
  if (!status) {
    return translate('pod.dbt.connection.engineUnknown', 'checking…')
  }
  if (status.engine === 'sqlglot') {
    return `sqlglot ${status.sqlglotVersion ?? ''} · ${status.python ?? ''} (${status.pythonSource ?? '?'})`
  }
  return `${translate('pod.dbt.connection.engineNameMatch', 'name matching')}${status.note ? ` · ${status.note}` : ''}`
}

function lspText(status: DbtLspStatus | undefined, enabled: boolean): string {
  if (!enabled) {
    return translate('pod.dbt.connection.lspDisabled', 'off (Settings › dbt)')
  }
  if (!status) {
    return translate('pod.dbt.connection.lspUnknown', 'not started')
  }
  const where = status.binary ? ` · ${status.binary} (${status.binarySource ?? '?'})` : ''
  switch (status.state) {
    case 'running':
      return `${translate('pod.dbt.connection.lspRunning', 'running')} ${status.serverVersion ?? ''}${where}`
    case 'starting':
      return status.downloading
        ? (status.message ?? translate('pod.dbt.connection.lspDownloading', 'downloading…'))
        : translate('pod.dbt.connection.lspStarting', 'starting…')
    case 'error':
      return `${translate('pod.dbt.connection.lspError', 'failed')}: ${status.message ?? ''}`
    case 'disabled':
      return translate('pod.dbt.connection.lspDisabled', 'off (Settings › dbt)')
    case 'unavailable':
      return status.message ?? translate('pod.dbt.connection.lspUnavailable', 'unavailable')
    default:
      return `${translate('pod.dbt.connection.lspStopped', 'stopped')}${status.message ? ` · ${status.message}` : ''}`
  }
}
