import { useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../shared/workspace-scope'
import {
  AE_INITIATIVE_STATUSES,
  type AeDomainConfig,
  type AeInitiative,
  type AeInitiativeStatus
} from '../../../shared/ae/domain-types'
import { taskLabel, useInitiativeRunTasks } from './use-initiative-run-tasks'
import { revealPodFolderWorkspace } from './reveal-folder-workspace'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function RepoRoles({
  domain,
  repoIds
}: {
  domain: AeDomainConfig
  repoIds?: string[]
}): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const entries = domain.repos.filter((entry) => !repoIds || repoIds.includes(entry.repoId))
  if (entries.length === 0) {
    return (
      <span className="text-muted-foreground">
        {translate('pod.initiative.panel.noRepos', 'none')}
      </span>
    )
  }
  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.repoId} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {repos.find((repo) => repo.id === entry.repoId)?.displayName ?? entry.repoId}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">{entry.role}</span>
        </li>
      ))}
    </ul>
  )
}

function InitiativeView({
  initiative,
  domain
}: {
  initiative: AeInitiative
  domain: AeDomainConfig | null
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const saveAeInitiative = useAppStore((s) => s.saveAeInitiative)
  const { tasks, loading, error, refresh } = useInitiativeRunTasks(initiative.runId, settings)
  const setStatus = (status: AeInitiativeStatus): void => {
    void saveAeInitiative({
      id: initiative.id,
      domainId: initiative.domainId,
      title: initiative.title,
      status
    })
  }
  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <div className="truncate text-sm font-medium text-foreground">{initiative.title}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {domain?.name ?? initiative.domainId}
          {initiative.stakeholderTeam ? ` · ${initiative.stakeholderTeam}` : ''}
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <Row label={translate('pod.initiative.panel.status', 'Status')}>
          <Select
            value={initiative.status}
            onValueChange={(value) => setStatus(value as AeInitiativeStatus)}
          >
            <SelectTrigger size="sm" className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AE_INITIATIVE_STATUSES.map((status) => (
                <SelectItem key={status} value={status} className="text-xs">
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        {domain && (
          <Row label={translate('pod.initiative.panel.repos', 'Repos')}>
            <RepoRoles domain={domain} repoIds={initiative.repoIds} />
          </Row>
        )}
        <Row label={translate('pod.initiative.panel.folder', 'Folder')}>
          <span className="break-all font-mono text-[11px]">{initiative.folderPath}</span>
        </Row>
        <Row label={translate('pod.initiative.panel.run', 'Run')}>
          {initiative.runId ? (
            <span className="font-mono text-[11px]">{initiative.runId}</span>
          ) : (
            <span className="text-muted-foreground">
              {translate(
                'pod.initiative.panel.noRun',
                'Not started. The main agent records the run with orca domain initiative-update.'
              )}
            </span>
          )}
        </Row>
        {initiative.runId && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {translate('pod.initiative.panel.tasks', 'Tasks')}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('pod.initiative.panel.refresh', 'Refresh tasks')}
                disabled={loading}
                onClick={refresh}
              >
                <RefreshCw className={loading ? 'size-3 animate-spin' : 'size-3'} />
              </Button>
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            {!error && tasks.length === 0 && !loading && (
              <p className="text-[11px] text-muted-foreground">
                {translate('pod.initiative.panel.noTasks', 'No tasks in this run yet.')}
              </p>
            )}
            <ul className="space-y-1">
              {tasks.map((task) => (
                <li key={task.id} className="rounded-md border border-border px-2 py-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{taskLabel(task)}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {task.status}
                    </span>
                  </div>
                  {task.assignee_handle && (
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {task.assignee_handle}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}

function DomainView({ domain }: { domain: AeDomainConfig }): React.JSX.Element {
  const initiatives = useAppStore((s) => s.aeInitiatives)
  const mine = initiatives.filter((initiative) => initiative.domainId === domain.id)
  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <div className="truncate text-sm font-medium text-foreground">{domain.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {translate('pod.initiative.panel.mainAgent', 'Domain main agent')}
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <Row label={translate('pod.initiative.panel.repos', 'Repos')}>
          <RepoRoles domain={domain} />
        </Row>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">
            {translate('pod.initiative.panel.initiatives', 'Initiatives')}
          </span>
          {mine.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'pod.initiative.panel.noInitiatives',
                'None yet. Use "New initiative…" in the group menu.'
              )}
            </p>
          ) : (
            <ul className="space-y-1">
              {mine.map((initiative) => (
                <li key={initiative.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1 text-left text-xs hover:bg-muted/50"
                    disabled={!initiative.coordinatorWorkspaceKey}
                    onClick={() =>
                      void revealPodFolderWorkspace(initiative.coordinatorWorkspaceKey)
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{initiative.title}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {initiative.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}

/** Pod: right-sidebar Initiative tab for the active folder workspace (an initiative or a domain main agent). */
export default function PodInitiativePanel(): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const aeDomains = useAppStore((s) => s.aeDomains)
  const aeInitiatives = useAppStore((s) => s.aeInitiatives)
  const aeLoaded = useAppStore((s) => s.aeLoaded)
  const fetchAeDomains = useAppStore((s) => s.fetchAeDomains)

  useEffect(() => {
    if (!aeLoaded) {
      void fetchAeDomains()
    }
  }, [aeLoaded, fetchAeDomains])

  const scope = parseWorkspaceKey(activeWorkspaceKey ?? activeWorktreeId ?? '')
  const workspaceKey = scope?.type === 'folder' ? folderWorkspaceKey(scope.folderWorkspaceId) : null
  const match = useMemo(() => {
    if (!workspaceKey) {
      return null
    }
    const initiative = aeInitiatives.find((entry) => entry.coordinatorWorkspaceKey === workspaceKey)
    if (initiative) {
      return { initiative, domain: aeDomains[initiative.domainId] ?? null }
    }
    const domain = Object.values(aeDomains).find(
      (entry) => entry.mainAgentWorkspaceKey === workspaceKey
    )
    return domain ? { initiative: null, domain } : null
  }, [workspaceKey, aeInitiatives, aeDomains])

  if (!match) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {workspaceKey
          ? translate(
              'pod.initiative.panel.notInitiative',
              'This folder is not a Pod initiative or domain main agent. Use "New initiative…" or "Domain settings…" in the group menu.'
            )
          : translate(
              'pod.initiative.panel.unavailable',
              'Initiatives are only shown for folder workspaces.'
            )}
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {match.initiative ? (
        <InitiativeView initiative={match.initiative} domain={match.domain} />
      ) : (
        <DomainView domain={match.domain} />
      )}
    </div>
  )
}
