import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2 } from 'lucide-react'
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
import type {
  AeSetupInitial,
  AeSetupItem,
  AeSetupQuestion,
  AeSetupRunRequest,
  AeSetupRunResult
} from '../../../shared/ae/setup-types'

/**
 * Pod: first setup from one choice. Picking the dbt repo runs detection; when nothing needs
 * the person Pod applies it and shows what it set up. It asks only for a production-looking
 * default target, a repo with several dbt projects, or a dbt that runs.
 */
export function AeSetupDialog({
  onOpenChange,
  initial
}: {
  onOpenChange: (open: boolean) => void
  initial?: AeSetupInitial
}): React.JSX.Element {
  const [request, setRequest] = useState<AeSetupRunRequest | null>(null)
  const [omniRepoPath, setOmniRepoPath] = useState(initial?.omniRepoPath ?? '')
  const [result, setResult] = useState<AeSetupRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (next: AeSetupRunRequest): Promise<void> => {
    setRequest(next)
    setBusy(true)
    setError(null)
    try {
      const outcome = await window.api.ae.setup.run(next)
      setResult(outcome)
      if (outcome.applied) {
        toast.success(
          outcome.applied.changed
            ? translate('pod.setup.applied', 'Domain set up')
            : translate('pod.setup.unchanged', 'Domain already set up; nothing changed')
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }
  const started = useRef(false)
  useEffect(() => {
    // Why once: a repo handed in by the Omni tab or the new-project offer is the person's choice already.
    if (!started.current && initial?.dbtRepoPath) {
      started.current = true
      void run({ dbtRepoPath: initial.dbtRepoPath, omniRepoPath: initial.omniRepoPath })
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once with the repo handed in at open.
  }, [])
  const pickRepo = (dbtRepoPath: string): void => {
    if (dbtRepoPath) {
      void run({ dbtRepoPath, omniRepoPath: omniRepoPath || undefined })
    }
  }

  const applied = result?.applied ?? null
  const questions = result && !applied ? result.questions : []
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-setup-phase={phaseOf(request, busy, result)}>
        <DialogHeader>
          <DialogTitle>
            {applied
              ? translate('pod.setup.doneTitle', 'Pod is set up')
              : translate('pod.setup.title', 'Set up Pod from your dbt repo')}
          </DialogTitle>
          <DialogDescription>
            {applied
              ? translate(
                  'pod.setup.doneDescription',
                  'This is what Pod found and set up. Change any of it later in Settings > Analytics Tools or the domain settings.'
                )
              : translate(
                  'pod.setup.description',
                  'Choose the folder of your dbt repo. Pod finds dbt, your profile and target, the Omni CLI and Python, and sets them up. It asks only when it cannot choose safely.'
                )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek max-h-[calc(100vh-14rem)] space-y-4 overflow-y-auto">
          {!request ? (
            <div className="space-y-1">
              <Label>{translate('pod.setup.dbtRepo', 'dbt repo')}</Label>
              <PodPathInput
                value=""
                placeholder="~/Projects/dbt-analytics"
                pick="directory"
                onCommit={pickRepo}
              />
              {omniRepoPath ? (
                <p className="text-xs text-muted-foreground">
                  {translate('pod.setup.omniWith', 'Omni repo: {{path}}', { path: omniRepoPath })}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              {request.dbtRepoPath}
            </p>
          )}
          {busy ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {translate('pod.setup.running', 'Looking at the repo and your tools…')}
            </p>
          ) : null}
          {request && questions.length > 0 ? (
            <SetupQuestions
              key={JSON.stringify(request)}
              questions={questions}
              busy={busy}
              onAnswer={(answers) => void run({ ...request, ...answers })}
            />
          ) : null}
          {result && !busy ? (
            <ul className="space-y-2" aria-label={translate('pod.setup.summary', 'What Pod found')}>
              {result.detection.items.map((item) => (
                <SetupItemRow key={item.key} item={item} />
              ))}
            </ul>
          ) : null}
          {applied && request && !request.omniRepoPath && !busy ? (
            <div className="space-y-1">
              <Label>{translate('pod.setup.addOmni', 'Add your Omni repo (optional)')}</Label>
              <PodPathInput
                value=""
                placeholder="~/Projects/omni-analytics"
                pick="directory"
                onCommit={(path) => {
                  if (path) {
                    setOmniRepoPath(path)
                    void run({ ...request, omniRepoPath: path })
                  }
                }}
              />
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          {applied ? (
            <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
              {translate('pod.setup.done', 'Done')}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {translate('pod.setup.cancel', 'Cancel')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function phaseOf(
  request: AeSetupRunRequest | null,
  busy: boolean,
  result: AeSetupRunResult | null
): string {
  if (busy) {
    return 'running'
  }
  if (result?.applied) {
    return 'applied'
  }
  if (result) {
    return 'question'
  }
  return request ? 'running' : 'pick'
}

type SetupAnswers = Pick<AeSetupRunRequest, 'target' | 'projectDir' | 'dbtBinary' | 'withoutDbt'>

function SetupQuestions({
  questions,
  busy,
  onAnswer
}: {
  questions: AeSetupQuestion[]
  busy: boolean
  onAnswer: (answers: SetupAnswers) => void
}): React.JSX.Element {
  const [answers, setAnswers] = useState<SetupAnswers>({})
  const set = (patch: SetupAnswers): void => setAnswers((current) => ({ ...current, ...patch }))
  const answered = questions.every((question) =>
    question.kind === 'target'
      ? Boolean(answers.target)
      : question.kind === 'project'
        ? Boolean(answers.projectDir)
        : Boolean(answers.dbtBinary || answers.withoutDbt)
  )
  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-setup-questions>
      {questions.map((question) => (
        <div key={question.kind} className="space-y-1.5" data-setup-question={question.kind}>
          <p className="text-xs text-foreground">{question.reason}</p>
          {question.kind === 'dbt' ? (
            <>
              <PodPathInput
                value={answers.dbtBinary ?? ''}
                placeholder="/Users/you/.pyenv/versions/3.11.4/bin/dbt"
                pick="file"
                onCommit={(path) => set({ dbtBinary: path || undefined, withoutDbt: false })}
              />
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onAnswer({ ...answers, withoutDbt: true })}
              >
                {translate('pod.setup.withoutDbt', 'Set up without dbt for now')}
              </Button>
            </>
          ) : (
            <Select
              value={question.kind === 'target' ? answers.target : answers.projectDir}
              onValueChange={(value) =>
                set(question.kind === 'target' ? { target: value } : { projectDir: value })
              }
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue
                  placeholder={
                    question.kind === 'target'
                      ? translate('pod.setup.chooseTarget', 'Choose a target')
                      : translate('pod.setup.chooseProject', 'Choose a project')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {question.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        disabled={busy || !answered}
        onClick={() => onAnswer(answers)}
      >
        {translate('pod.setup.continue', 'Continue')}
      </Button>
    </div>
  )
}

function SetupItemRow({ item }: { item: AeSetupItem }): React.JSX.Element {
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
      </div>
    </li>
  )
}
