import { useEffect, useId, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { revealPodFolderWorkspace } from './reveal-folder-workspace'

/** Pod: name an initiative, pick its repos, and open the main agent in the new initiative folder. */
export function NewInitiativeDialog({
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
  const launchAeInitiative = useAppStore((s) => s.launchAeInitiative)
  const repos = useAppStore((s) => s.repos)
  const groupRepos = useMemo(
    () => repos.filter((repo) => repo.projectGroupId === groupId),
    [repos, groupId]
  )
  const teamsListId = useId()
  const [title, setTitle] = useState('')
  const [team, setTeam] = useState('')
  const [excludedRepoIds, setExcludedRepoIds] = useState<ReadonlySet<string>>(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmedTitle = title.trim()
  const repoIds = groupRepos.map((repo) => repo.id).filter((id) => !excludedRepoIds.has(id))

  useEffect(() => {
    if (!aeLoaded) {
      void fetchAeDomains()
    }
  }, [aeLoaded, fetchAeDomains])

  const toggleRepo = (repoId: string, checked: boolean): void => {
    setExcludedRepoIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.delete(repoId)
      } else {
        next.add(repoId)
      }
      return next
    })
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!trimmedTitle || submitting || repoIds.length === 0) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (!domain) {
        // Why: first initiative on a plain project group; the service detects roles from the repo contents.
        await saveAeDomain({ id: groupId, name: label })
      }
      const initiative = await launchAeInitiative({
        domainId: groupId,
        title: trimmedTitle,
        stakeholderTeam: team.trim() || undefined,
        repoIds
      })
      await revealPodFolderWorkspace(initiative.coordinatorWorkspaceKey)
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('pod.initiative.new.title', 'New initiative in {{value0}}', {
              value0: domain?.name ?? label
            })}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'pod.initiative.new.description',
              'Creates initiatives/<slug>/INITIATIVE.md, a folder workspace for it, and opens the main agent there with the planning prompt drafted.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              {translate('pod.initiative.new.name', 'Title')}
            </Label>
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={translate('pod.initiative.new.namePlaceholder', 'OpenCX migration')}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              {translate('pod.initiative.new.team', 'Stakeholder team')}
            </Label>
            <Input
              value={team}
              list={teamsListId}
              onChange={(event) => setTeam(event.target.value)}
              placeholder={translate('pod.initiative.new.teamPlaceholder', 'Support Optimisation')}
              className="h-8 text-xs"
            />
            <datalist id={teamsListId}>
              {(domain?.stakeholderTeams ?? []).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              {translate('pod.initiative.new.repos', 'Repos this initiative touches')}
            </Label>
            {groupRepos.length === 0 ? (
              <p className="text-[11px] text-destructive">
                {translate(
                  'pod.initiative.new.noRepos',
                  'This group has no repos. Add the dbt and Omni repos first.'
                )}
              </p>
            ) : (
              <ul className="space-y-1">
                {groupRepos.map((repo) => {
                  const role =
                    domain?.repos.find((entry) => entry.repoId === repo.id)?.role ?? 'other'
                  const checkboxId = `${teamsListId}-${repo.id}`
                  return (
                    <li key={repo.id} className="flex items-center gap-2">
                      <Checkbox
                        id={checkboxId}
                        checked={!excludedRepoIds.has(repo.id)}
                        onCheckedChange={(checked) => toggleRepo(repo.id, checked === true)}
                      />
                      <label htmlFor={checkboxId} className="min-w-0 flex-1 truncate text-xs">
                        {repo.displayName}
                      </label>
                      <span className="font-mono text-[11px] text-muted-foreground">{role}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              {translate('pod.initiative.new.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="text-xs"
              disabled={!trimmedTitle || submitting || repoIds.length === 0}
            >
              {submitting
                ? translate('pod.initiative.new.starting', 'Starting…')
                : translate('pod.initiative.new.start', 'Start initiative')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
