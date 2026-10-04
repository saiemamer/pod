import { useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PodPathInput } from '@/components/settings/PodPathInput'
import { translate } from '@/i18n/i18n'
import type { AeSetupDetection, AeSetupItem } from '../../../shared/ae/setup-types'

/**
 * Pod: first setup from two folders. Detect reads the repos and runs `--version` on the
 * tools; Apply creates or updates the domain, its dbt defaults and the tool paths.
 */
export function AeSetupDialog({
  onOpenChange
}: {
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [dbtRepoPath, setDbtRepoPath] = useState('')
  const [omniRepoPath, setOmniRepoPath] = useState('')
  const [detection, setDetection] = useState<AeSetupDetection | null>(null)
  const [target, setTarget] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<'detect' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (kind: 'detect' | 'apply', task: () => Promise<void>): Promise<void> => {
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
  const detect = (): Promise<void> =>
    run('detect', async () => {
      const found = await window.api.ae.setup.detect({
        dbtRepoPath,
        omniRepoPath: omniRepoPath || undefined
      })
      setDetection(found)
      setTarget(undefined)
    })
  const apply = (): Promise<void> =>
    run('apply', async () => {
      if (!detection) {
        return
      }
      const result = await window.api.ae.setup.apply({ detection, target })
      toast.success(
        result.changed
          ? translate('pod.setup.applied', 'Domain set up')
          : translate('pod.setup.unchanged', 'Domain already set up; nothing changed')
      )
      onOpenChange(false)
    })
  const pathsChanged = (): void => setDetection(null)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('pod.setup.title', 'Set up from your repos')}</DialogTitle>
          <DialogDescription>
            {translate(
              'pod.setup.description',
              'Choose your dbt repo and, if you have one, your Omni repo. Pod finds dbt, your profile and target, the Omni CLI and Python, and shows what it found before changing anything.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek max-h-[calc(100vh-14rem)] space-y-4 overflow-y-auto">
          <div className="space-y-1">
            <Label>{translate('pod.setup.dbtRepo', 'dbt repo')}</Label>
            <PodPathInput
              value={dbtRepoPath}
              placeholder="~/Projects/dbt-analytics"
              pick="directory"
              onCommit={(value) => {
                setDbtRepoPath(value)
                pathsChanged()
              }}
            />
          </div>
          <div className="space-y-1">
            <Label>{translate('pod.setup.omniRepo', 'Omni repo (optional)')}</Label>
            <PodPathInput
              value={omniRepoPath}
              placeholder="~/Projects/omni-analytics"
              pick="directory"
              onCommit={(value) => {
                setOmniRepoPath(value)
                pathsChanged()
              }}
            />
          </div>
          {detection ? (
            <ul className="space-y-2" aria-label={translate('pod.setup.summary', 'What Pod found')}>
              {detection.items.map((item) => (
                <SetupItemRow
                  key={item.key}
                  item={item}
                  targets={item.key === 'target' ? detection.profiles.targets : []}
                  target={target}
                  onTarget={setTarget}
                />
              ))}
            </ul>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null || !dbtRepoPath}
            onClick={() => void detect()}
          >
            {busy === 'detect'
              ? translate('pod.setup.detecting', 'Detecting…')
              : translate('pod.setup.detect', 'Detect')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || !detection}
            onClick={() => void apply()}
          >
            {busy === 'apply'
              ? translate('pod.setup.applying', 'Applying…')
              : translate('pod.setup.apply', 'Apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SetupItemRow({
  item,
  targets,
  target,
  onTarget
}: {
  item: AeSetupItem
  targets: string[]
  target: string | undefined
  onTarget: (value: string) => void
}): React.JSX.Element {
  const Icon =
    item.status === 'found' ? CheckCircle2 : item.status === 'choose' ? CircleHelp : AlertTriangle
  return (
    <li className="flex gap-2 text-xs" data-setup-item={item.key} data-setup-status={item.status}>
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-foreground">{item.label}</span>
          {item.value ? (
            <span className="break-all font-mono text-[11px] text-muted-foreground">
              {item.value}
            </span>
          ) : null}
        </div>
        {item.hint ? <p className="text-muted-foreground">{item.hint}</p> : null}
        {item.status === 'choose' && targets.length > 0 ? (
          <Select value={target} onValueChange={onTarget}>
            <SelectTrigger size="sm" className="w-48">
              <SelectValue placeholder={translate('pod.setup.chooseTarget', 'Choose a target')} />
            </SelectTrigger>
            <SelectContent>
              {targets.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </li>
  )
}
