import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PodPathInput } from '@/components/settings/PodPathInput'
import { activateAndRevealFolderWorkspace } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { AE_REPO_ROLES, type AeRepoRole } from '../../../shared/ae/domain-types'
import { ALL_TUI_AGENTS, TUI_AGENT_DISPLAY_NAMES } from '../../../shared/tui-agent-display-names'
import type { TuiAgent } from '../../../shared/tui-agent'
import { DomainSecretsSection } from './DomainSecretsSection'
import {
  domainInputFromDraft,
  draftFromDomain,
  type DomainSettingsDraft
} from './domain-settings-form'

const DEFAULT_AGENT_VALUE = 'pod-default'

/** Pod: turn a project group into a domain, or edit one. Saving creates the domain on first use. */
export function DomainSettingsDialog({
  groupId,
  label,
  onOpenChange
}: {
  groupId: string
  label: string
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const domain = useAppStore((s) => s.aeDomains[groupId] ?? null)
  const aeLoaded = useAppStore((s) => s.aeLoaded)
  const fetchAeDomains = useAppStore((s) => s.fetchAeDomains)
  const saveAeDomain = useAppStore((s) => s.saveAeDomain)
  const detectAeRepoRoles = useAppStore((s) => s.detectAeRepoRoles)
  const openAeDomainMainAgent = useAppStore((s) => s.openAeDomainMainAgent)
  const fetchFolderWorkspaces = useAppStore((s) => s.fetchFolderWorkspaces)
  const repos = useAppStore((s) => s.repos)
  const groupRepos = useMemo(
    () => repos.filter((repo) => repo.projectGroupId === groupId),
    [repos, groupId]
  )
  const [draft, setDraft] = useState<DomainSettingsDraft | null>(null)
  const [busy, setBusy] = useState<'save' | 'detect' | 'agent' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!aeLoaded) {
      void fetchAeDomains()
    }
  }, [aeLoaded, fetchAeDomains])

  // Why: the form seeds once the store has loaded domains; seeding earlier would show an empty domain for a second.
  if (aeLoaded && draft === null) {
    setDraft(draftFromDomain(domain, { label, repoIds: groupRepos.map((repo) => repo.id) }))
  }

  const patch = (changes: Partial<DomainSettingsDraft>): void => {
    setDraft((current) => (current ? { ...current, ...changes } : current))
  }
  const setRole = (repoId: string, role: AeRepoRole): void => {
    setDraft((current) =>
      current
        ? {
            ...current,
            repos: current.repos.map((entry) =>
              entry.repoId === repoId ? { ...entry, role } : entry
            )
          }
        : current
    )
  }
  const run = async (
    kind: 'save' | 'detect' | 'agent',
    task: () => Promise<void>
  ): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(kind)
    setError(null)
    try {
      await task()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(null)
    }
  }
  const save = async (): Promise<void> => {
    if (draft) {
      await saveAeDomain(domainInputFromDraft(groupId, label, draft))
    }
  }
  const detect = (): Promise<void> =>
    run('detect', async () => {
      const detected = await detectAeRepoRoles(groupId)
      patch({ repos: detected })
    })
  const openMainAgent = (): Promise<void> =>
    run('agent', async () => {
      await save()
      const result = await openAeDomainMainAgent(groupId)
      const workspaceId = result.workspaceKey.replace(/^folder:/, '')
      if (!activateAndRevealFolderWorkspace(workspaceId, { providesInitialSurface: true })) {
        // Why: the main process created the workspace a moment ago; the renderer list may not have it yet.
        await fetchFolderWorkspaces()
        activateAndRevealFolderWorkspace(workspaceId, { providesInitialSurface: true })
      }
      onOpenChange(false)
    })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="scrollbar-sleek max-h-[calc(100vh-6rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('pod.domain.settings.title', 'Domain settings')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'pod.domain.settings.description',
              'A domain is this group of repos with a role each. Its main agent plans initiatives and dispatches workers into the right repo.'
            )}
          </DialogDescription>
        </DialogHeader>
        {draft ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void run('save', async () => {
                await save()
                onOpenChange(false)
              })
            }}
          >
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {translate('pod.domain.settings.name', 'Name')}
              </Label>
              <Input
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground">
                  {translate('pod.domain.settings.repos', 'Repos and roles')}
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy !== null || groupRepos.length === 0}
                  onClick={() => void detect()}
                >
                  {busy === 'detect'
                    ? translate('pod.domain.settings.detecting', 'Detecting…')
                    : translate('pod.domain.settings.detect', 'Detect roles')}
                </Button>
              </div>
              {groupRepos.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {translate('pod.domain.settings.noRepos', 'No repos in this group yet.')}
                </p>
              ) : (
                <ul className="space-y-1">
                  {draft.repos.map((entry) => {
                    const repo = groupRepos.find((candidate) => candidate.id === entry.repoId)
                    return (
                      <li key={entry.repoId} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs" title={repo?.path}>
                          {repo?.displayName ?? entry.repoId}
                        </span>
                        <Select
                          value={entry.role}
                          onValueChange={(value) => setRole(entry.repoId, value as AeRepoRole)}
                        >
                          <SelectTrigger size="sm" className="h-7 w-24 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {AE_REPO_ROLES.map((role) => (
                              <SelectItem key={role} value={role} className="text-xs">
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {translate('pod.domain.settings.teams', 'Stakeholder teams, one per line')}
              </Label>
              <Textarea
                value={draft.teamsText}
                onChange={(event) => patch({ teamsText: event.target.value })}
                rows={3}
                className="text-xs"
                placeholder={'Support Optimisation\nChannels'}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {translate('pod.domain.settings.env', 'Agent environment, KEY=value per line')}
              </Label>
              <Textarea
                value={draft.envText}
                onChange={(event) => patch({ envText: event.target.value })}
                rows={3}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder="OMNI_BASE_URL=https://example.omniapp.co"
              />
            </div>
            <DomainSecretsSection
              domainId={groupId}
              secretNames={domain?.secretNames ?? []}
              ensureDomain={save}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  {translate('pod.domain.settings.dbtTarget', 'dbt target')}
                </Label>
                <Input
                  value={draft.dbtTarget}
                  onChange={(event) => patch({ dbtTarget: event.target.value })}
                  placeholder="dev"
                  spellCheck={false}
                  className="h-7 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  {translate('pod.domain.settings.defaultAgent', 'Default agent')}
                </Label>
                <Select
                  value={draft.defaultAgent || DEFAULT_AGENT_VALUE}
                  onValueChange={(value) =>
                    patch({ defaultAgent: value === DEFAULT_AGENT_VALUE ? '' : value })
                  }
                >
                  <SelectTrigger size="sm" className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_AGENT_VALUE} className="text-xs">
                      {translate('pod.domain.settings.agentDefault', 'Claude Code (default)')}
                    </SelectItem>
                    {ALL_TUI_AGENTS.map((agent: TuiAgent) => (
                      <SelectItem key={agent} value={agent} className="text-xs">
                        {TUI_AGENT_DISPLAY_NAMES[agent]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {translate('pod.domain.settings.dbtProfilesDir', 'dbt profiles directory')}
              </Label>
              <PodPathInput
                value={draft.dbtProfilesDir || undefined}
                placeholder="~/.dbt"
                pick="directory"
                onCommit={(value) => patch({ dbtProfilesDir: value })}
              />
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-xs"
                disabled={busy !== null}
                onClick={() => void openMainAgent()}
              >
                {busy === 'agent'
                  ? translate('pod.domain.settings.openingAgent', 'Opening…')
                  : translate('pod.domain.settings.openAgent', 'Open main agent')}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => onOpenChange(false)}
                >
                  {translate('pod.domain.settings.cancel', 'Cancel')}
                </Button>
                <Button type="submit" size="sm" className="text-xs" disabled={busy !== null}>
                  {busy === 'save'
                    ? translate('pod.domain.settings.saving', 'Saving…')
                    : translate('pod.domain.settings.save', 'Save')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            {translate('pod.domain.settings.loading', 'Loading…')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
