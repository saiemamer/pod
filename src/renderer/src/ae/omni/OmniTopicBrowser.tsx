import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  OmniTopicDetail,
  OmniTopicRelationship,
  OmniTopicSummary
} from '../../../../shared/ae/omni-types'
import { podDbtErrorMessage } from '../dbt/pod-dbt-run-target'

/**
 * Pod: topics of the worktree's Omni model branch (or the shared model before the
 * branch exists). A row opens to the topic's views, fields and joins, fetched once.
 */
export function OmniTopicBrowser({
  worktreePath,
  /** Changes when the branch appears or the panel reloads, so the list re-reads. */
  sourceKey
}: {
  worktreePath: string
  sourceKey: string
}): React.JSX.Element {
  const [topics, setTopics] = useState<OmniTopicSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, OmniTopicDetail | string>>({})
  // Why a generation: a topic answer from before a source change must not land in the reset list.
  const generation = useRef(0)

  useEffect(() => {
    const api = window.api?.ae?.omni
    if (!api) {
      return
    }
    let cancelled = false
    generation.current += 1
    setTopics(null)
    setError(null)
    setDetails({})
    setOpen(null)
    void api
      .topics({ path: worktreePath })
      .then((result) => !cancelled && setTopics(result.topics))
      .catch((cause) => !cancelled && setError(podDbtErrorMessage(cause)))
    return () => {
      cancelled = true
    }
  }, [worktreePath, sourceKey])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (topics ?? []).filter(
      (topic) =>
        !needle ||
        topic.name.toLowerCase().includes(needle) ||
        (topic.label ?? '').toLowerCase().includes(needle)
    )
  }, [topics, filter])

  const toggle = (name: string): void => {
    if (open === name) {
      setOpen(null)
      return
    }
    setOpen(name)
    if (details[name]) {
      return
    }
    const asked = generation.current
    const keep = (value: OmniTopicDetail | string): void => {
      if (asked === generation.current) {
        setDetails((current) => ({ ...current, [name]: value }))
      }
    }
    void window.api.ae.omni
      .topic({ path: worktreePath, topic: name })
      .then(keep)
      .catch((cause) => keep(podDbtErrorMessage(cause)))
  }

  return (
    <div className="space-y-1" data-testid="pod-omni-topics">
      {topics && topics.length > 0 && (
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={translate('pod.omni.topics.filter', 'Filter topics')}
          aria-label={translate('pod.omni.topics.filter', 'Filter topics')}
          className="h-6 text-xs"
        />
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {!topics && !error && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {translate('pod.omni.topics.loading', 'Reading topics…')}
        </p>
      )}
      {topics && topics.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          {translate('pod.omni.topics.none', 'This model has no topics.')}
        </p>
      )}
      <ul>
        {shown.map((topic) => (
          <li key={topic.name}>
            <button
              type="button"
              className="flex h-6 w-full items-center gap-1 rounded-md px-1 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              onClick={() => toggle(topic.name)}
              data-testid="pod-omni-topic"
              aria-expanded={open === topic.name}
            >
              <ChevronRight
                className={cn(
                  'size-3 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none',
                  open === topic.name && 'rotate-90'
                )}
              />
              <span
                className={cn('min-w-0 flex-1 truncate', topic.hidden && 'text-muted-foreground')}
              >
                {topic.label ?? topic.name}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {topic.composite
                  ? translate('pod.omni.topics.composite', 'composite')
                  : topic.hidden
                    ? translate('pod.omni.topics.hidden', 'hidden')
                    : topic.name}
              </span>
            </button>
            {open === topic.name && <TopicDetail detail={details[topic.name]} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TopicDetail({
  detail
}: {
  detail: OmniTopicDetail | string | undefined
}): React.JSX.Element {
  if (!detail) {
    return (
      <p className="flex items-center gap-1 py-1 pl-5 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {translate('pod.omni.topics.reading', 'Reading topic…')}
      </p>
    )
  }
  if (typeof detail === 'string') {
    return <p className="py-1 pl-5 text-[11px] text-destructive">{detail}</p>
  }
  return (
    <div
      className="space-y-1.5 py-1 pl-5 pr-1 text-[11px] animate-in fade-in-0 duration-150 motion-reduce:animate-none"
      data-testid="pod-omni-topic-detail"
    >
      {detail.description && <p className="text-muted-foreground">{detail.description}</p>}
      {detail.views.map((view) => (
        <div key={view.name}>
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">{view.label ?? view.name}</span>
            <span className="text-muted-foreground">
              {translate('pod.omni.topics.fieldCounts', 'dimensions {{dims}} · measures {{meas}}', {
                dims: view.dimensions.length,
                meas: view.measures.length
              })}
            </span>
          </div>
          <div className="break-words font-mono text-[10px] text-muted-foreground">
            {[...view.dimensions, ...view.measures].join(', ')}
          </div>
        </div>
      ))}
      {detail.relationships.length > 0 && (
        <div>
          <span className="font-medium text-foreground">
            {translate('pod.omni.topics.joins', 'Joins')}
          </span>
          {joinRows(detail).map(({ key, rel }) => (
            <div key={key} className="font-mono text-[10px] text-muted-foreground">
              {rel.left} → {rel.right}
              {rel.relationship ? ` (${rel.relationship})` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Why a counter: two joins between the same pair of views are legal, so the pair alone is no key. */
function joinRows(detail: OmniTopicDetail): { key: string; rel: OmniTopicRelationship }[] {
  const seen = new Map<string, number>()
  return detail.relationships.map((rel) => {
    const pair = `${rel.left}>${rel.right}`
    const count = (seen.get(pair) ?? 0) + 1
    seen.set(pair, count)
    return { key: `${pair}#${count}`, rel }
  })
}
