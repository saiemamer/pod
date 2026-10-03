import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import type {
  OmniBranchResult,
  OmniContextSummary,
  OmniValidateResult
} from '../../../../shared/ae/omni-types'
import { podDbtErrorMessage } from '../dbt/pod-dbt-run-target'

export type OmniPanelState = {
  context: OmniContextSummary | null
  branch: OmniBranchResult | null
  validation: OmniValidateResult | null
  loading: boolean
  /** Which action is in flight, so only its button shows a spinner. */
  busy: 'create' | 'validate' | null
  error: string | null
  /** Bumps on every reload, for views that re-read alongside the panel. */
  generation: number
  reload: () => void
  createBranch: () => Promise<void>
  validate: () => Promise<void>
}

/** Pod: the Omni panel's data for one worktree: context, the model branch, the last validation. */
export function useOmniPanel(worktreePath: string | null): OmniPanelState {
  const [context, setContext] = useState<OmniContextSummary | null>(null)
  const [branch, setBranch] = useState<OmniBranchResult | null>(null)
  const [validation, setValidation] = useState<OmniValidateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<OmniPanelState['busy']>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const api = window.api?.ae?.omni
    setValidation(null)
    if (!api || !worktreePath) {
      // Why reset here: a load cancelled by this change skips its own reset.
      setContext(null)
      setBranch(null)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const next = await api.context({ path: worktreePath })
        if (cancelled) {
          return
        }
        setContext(next)
        // Why gate on both: without a model or a branch name there is nothing to look up.
        const found =
          next.modelId && next.gitBranch ? await api.branch({ path: worktreePath }) : null
        if (!cancelled) {
          setBranch(found)
        }
      } catch (cause) {
        if (!cancelled) {
          setBranch(null)
          setError(podDbtErrorMessage(cause))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [worktreePath, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  // Why follow the store: OMNI_MODEL_ID lives in the domain env, which Domain settings,
  // the picker or `orca domain` can change while the panel is open; `ae:changed` keeps the
  // store current.
  const fetchAeDomains = useAppStore((s) => s.fetchAeDomains)
  const domainId = context?.domainId ?? null
  const domainModelId = useAppStore((s) =>
    !s.aeLoaded || !domainId ? undefined : s.aeDomains[domainId]?.env.OMNI_MODEL_ID?.trim() || null
  )
  const seenDomainModelId = useRef<string | null | undefined>(undefined)
  const seenDomainId = useRef<string | null>(null)
  useEffect(() => {
    void fetchAeDomains()
  }, [fetchAeDomains])
  useEffect(() => {
    if (domainModelId === undefined || !context) {
      return
    }
    if (seenDomainId.current !== domainId) {
      // Why: another domain's value says nothing about this one; compare afresh.
      seenDomainId.current = domainId
      seenDomainModelId.current = undefined
    }
    const previous = seenDomainModelId.current
    seenDomainModelId.current = domainModelId
    const resolvedFromDomain = context.modelIdSource === 'domain' ? context.modelId : null
    // Why compare only on change: a reload replaces `context`, and re-checking on that would loop.
    const changed =
      previous === undefined ? domainModelId !== resolvedFromDomain : domainModelId !== previous
    if (changed && context.modelIdSource !== 'request') {
      reload()
    }
  }, [domainModelId, domainId, context, reload])

  const createBranch = useCallback(async () => {
    const api = window.api?.ae?.omni
    if (!api || !worktreePath) {
      return
    }
    setBusy('create')
    setError(null)
    try {
      setBranch(await api.branch({ path: worktreePath, create: true }))
      setValidation(null)
    } catch (cause) {
      setError(podDbtErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }, [worktreePath])

  const validate = useCallback(async () => {
    const api = window.api?.ae?.omni
    if (!api || !worktreePath) {
      return
    }
    setBusy('validate')
    setError(null)
    try {
      setValidation(await api.validate({ path: worktreePath }))
    } catch (cause) {
      setError(podDbtErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }, [worktreePath])

  return {
    context,
    branch,
    validation,
    loading,
    busy,
    error,
    generation: reloadKey,
    reload,
    createBranch,
    validate
  }
}
