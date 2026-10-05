import { useEffect, useState } from 'react'
import { CircleX, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import type {
  OmniContextSummary,
  OmniModel,
  OmniModelsResult,
  OmniValidateResult
} from '../../../../shared/ae/omni-types'
import { podDbtErrorMessage } from '../dbt/pod-dbt-run-target'
import { OmniErrorNote } from './OmniErrorNote'
import { PodSetupThisRepo } from '../PodSetupButton'
import { OmniTopicBrowser } from './OmniTopicBrowser'
import { useOmniPanel } from './use-omni-panel'

/**
 * Pod: the Omni tab of the right sidebar. For the active worktree it shows the Omni
 * model branch named after the git branch, creates it, validates it, and browses the
 * model's topics on that branch.
 */
export default function OmniPanel(): React.JSX.Element {
  const worktreePath = useActiveWorktree()?.path ?? null
  const state = useOmniPanel(worktreePath)
  const { context, branch, validation, loading, busy, error } = state
  const ready = Boolean(context?.modelId && context.gitBranch)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pod-omni-panel">
      <div className="flex h-8 min-h-8 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {translate('pod.omni.title', 'Omni')}
          {context?.gitBranch && (
            <span className="text-muted-foreground"> · {context.gitBranch}</span>
          )}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate('pod.omni.reload', 'Reload')}
              disabled={loading || !worktreePath}
              onClick={state.reload}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('pod.omni.reload', 'Reload')}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {!worktreePath && (
          <Note text={translate('pod.omni.noWorktree', 'Open a worktree of an Omni repo.')} />
        )}
        {error && <OmniErrorNote text={error} />}
        {worktreePath && context && !context.binary && (
          <Note
            text={translate(
              'pod.omni.noBinary',
              'No omni binary found. Install the Omni CLI, or set its path in Settings > Analytics Tools.'
            )}
          />
        )}
        {worktreePath && context && !context.modelId && (
          <OmniModelPicker worktreePath={worktreePath} context={context} />
        )}
        {worktreePath && context?.modelId && (
          <section className="space-y-1">
            <Heading text={translate('pod.omni.branch', 'Model branch')} />
            <Row label={translate('pod.omni.model', 'Model')}>
              <span className="break-all font-mono text-[11px]">{context.modelId}</span>
            </Row>
            <Row label={translate('pod.omni.gitBranch', 'Branch')}>
              {context.gitBranch ? (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {context.gitBranch}
                  </span>
                  <span
                    className="shrink-0 text-[11px] text-muted-foreground"
                    data-testid="pod-omni-branch-status"
                  >
                    {branch?.branch
                      ? translate('pod.omni.branchOnOmni', 'on Omni')
                      : branch
                        ? translate('pod.omni.branchMissing', 'not on Omni yet')
                        : ''}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  {translate('pod.omni.detached', 'Detached HEAD; check out a branch.')}
                </span>
              )}
            </Row>
            {branch && branch.branches.length > (branch.branch ? 1 : 0) && (
              <Row label={translate('pod.omni.otherBranches', 'Others')}>
                <span className="text-muted-foreground">
                  {branch.branches
                    .filter((entry) => entry.name !== branch.branchName)
                    .map((entry) => entry.name)
                    .join(', ')}
                </span>
              </Row>
            )}
            <div className="flex gap-2 pt-1">
              {branch && !branch.branch && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => void state.createBranch()}
                >
                  {busy === 'create' && <Loader2 className="animate-spin" />}
                  {translate('pod.omni.createBranch', 'Create branch')}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={busy !== null || !ready}
                onClick={() => void state.validate()}
              >
                {busy === 'validate' && <Loader2 className="animate-spin" />}
                {translate('pod.omni.validate', 'Validate')}
              </Button>
            </div>
            {validation && <ValidationResult result={validation} />}
          </section>
        )}
        {worktreePath && context?.modelId && (
          <section className="space-y-1">
            <Heading text={translate('pod.omni.topics', 'Topics')} />
            <OmniTopicBrowser
              worktreePath={worktreePath}
              sourceKey={`${context.modelId}:${branch?.branch?.id ?? 'model'}:${state.generation}`}
            />
          </section>
        )}
      </div>
    </div>
  )
}

function ValidationResult({ result }: { result: OmniValidateResult }): React.JSX.Element {
  const target = result.branch
    ? translate('pod.omni.validatedBranch', 'branch')
    : translate('pod.omni.validatedModel', 'shared model')
  return (
    <div className="space-y-1 pt-1" data-testid="pod-omni-validation">
      <p className={result.valid ? 'text-xs text-foreground' : 'text-xs text-destructive'}>
        {result.valid
          ? translate('pod.omni.valid', 'Valid {{target}}, {{warn}} warning(s)', {
              target,
              warn: result.warnings
            })
          : translate(
              'pod.omni.invalid',
              'Invalid {{target}}: {{errs}} error(s), {{warn}} warning(s)',
              {
                target,
                errs: result.errors,
                warn: result.warnings
              }
            )}
      </p>
      {result.issues.length > 0 && (
        <ul className="space-y-1">
          {result.issues.map((issue) => (
            <li
              key={`${issue.severity}:${issue.yamlPath ?? ''}:${issue.view ?? ''}:${issue.field ?? ''}:${issue.message}`}
              className="flex gap-1.5 rounded-md border border-border px-2 py-1 text-[11px]"
            >
              {issue.severity === 'error' ? (
                <CircleX className="mt-px size-3 shrink-0 text-destructive" />
              ) : (
                <TriangleAlert className="mt-px size-3 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                {(issue.yamlPath || issue.view) && (
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {issue.yamlPath ?? [issue.view, issue.field].filter(Boolean).join('.')}
                  </div>
                )}
                <div className="break-words">{issue.message}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Why save into the domain: agents launched in the repo then get the same OMNI_MODEL_ID, and the panel reloads when the store sees it. */
function OmniModelPicker({
  worktreePath,
  context
}: {
  worktreePath: string
  context: OmniContextSummary
}): React.JSX.Element {
  const domain = useAppStore((s) => (context.domainId ? s.aeDomains[context.domainId] : undefined))
  const domainsLoaded = useAppStore((s) => s.aeLoaded)
  const saveAeDomain = useAppStore((s) => s.saveAeDomain)
  const [result, setResult] = useState<OmniModelsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!context.binary) {
      return
    }
    let cancelled = false
    setResult(null)
    setError(null)
    void window.api.ae.omni
      .models({ path: worktreePath })
      .then((next) => !cancelled && setResult(next))
      .catch((cause) => !cancelled && setError(podDbtErrorMessage(cause)))
    return () => {
      cancelled = true
    }
  }, [worktreePath, context.binary])

  const choose = async (model: OmniModel): Promise<void> => {
    if (!domain) {
      return
    }
    setSaving(model.id)
    try {
      await saveAeDomain({ id: domain.id, env: { ...domain.env, OMNI_MODEL_ID: model.id } })
    } catch (cause) {
      setError(podDbtErrorMessage(cause))
    } finally {
      setSaving(null)
    }
  }

  const shared = (result?.models ?? []).filter((model) => model.modelKind?.startsWith('SHARED'))
  return (
    <section className="space-y-1" data-testid="pod-omni-model-picker">
      <Heading text={translate('pod.omni.chooseModel', 'Choose the Omni model')} />
      <div className="text-[11px] text-muted-foreground">
        {!domainsLoaded ? null : domain ? (
          translate(
            'pod.omni.chooseModelDomain',
            'Pod saves the choice as OMNI_MODEL_ID in the {{name}} domain, so agents in this repo use it too.',
            { name: domain.name }
          )
        ) : (
          <PodSetupThisRepo
            path={worktreePath}
            message={translate(
              'pod.omni.chooseModelNoDomain',
              'Pod has not set up this repo yet, so it has nowhere to keep the model you choose.'
            )}
          />
        )}
      </div>
      {error && <OmniErrorNote text={error} />}
      {context.binary && !result && !error && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {translate('pod.omni.readingModels', 'Reading models…')}
        </p>
      )}
      {result && shared.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'pod.omni.noSharedModels',
            'No shared models found. Check that the token can see the model, or set OMNI_MODEL_ID by hand.'
          )}
        </p>
      )}
      <ul className="space-y-1">
        {shared.map((model) => (
          <li
            key={model.id}
            className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{model.name ?? model.id}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">{model.id}</div>
            </div>
            {domain && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={saving !== null}
                onClick={() => void choose(model)}
              >
                {saving === model.id && <Loader2 className="animate-spin" />}
                {translate('pod.omni.useModel', 'Use')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {result?.truncated && (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'pod.omni.modelsTruncated',
            'Showing the first 1,000 models. Set OMNI_MODEL_ID by hand for one beyond them.'
          )}
        </p>
      )}
    </section>
  )
}

function Heading({ text }: { text: string }): React.JSX.Element {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {text}
    </h3>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Note({ text, destructive }: { text: string; destructive?: boolean }): React.JSX.Element {
  return (
    <p className={destructive ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
      {text}
    </p>
  )
}
