import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/

/** Names whose stored value Pod cannot read; refetched when the names change or a value is saved. */
function useUnreadableSecretNames(
  domainId: string,
  secretNames: string[],
  saves: number
): string[] {
  const [unreadable, setUnreadable] = useState<string[]>([])
  const namesKey = secretNames.join(',')
  useEffect(() => {
    let cancelled = false
    const domains = typeof window !== 'undefined' ? window.api?.ae?.domains : undefined
    if (!domains || !namesKey) {
      setUnreadable([])
      return
    }
    void domains
      .unreadableSecrets({ domainId })
      .then((names) => {
        if (!cancelled) {
          setUnreadable(names)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [domainId, namesKey, saves])
  return unreadable
}

/** Pod: secret names for a domain; values go straight to the main process and never come back. */
export function DomainSecretsSection({
  domainId,
  secretNames,
  ensureDomain
}: {
  domainId: string
  secretNames: string[]
  /** Saves the form first, because a secret needs a stored domain to attach to. */
  ensureDomain: () => Promise<void>
}): React.JSX.Element {
  const setAeDomainSecret = useAppStore((s) => s.setAeDomainSecret)
  const removeAeDomainSecret = useAppStore((s) => s.removeAeDomainSecret)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saves, setSaves] = useState(0)
  const unreadable = useUnreadableSecretNames(domainId, secretNames, saves)
  const trimmedName = name.trim()
  const canAdd = SECRET_NAME.test(trimmedName) && value.length > 0 && !busy

  const add = async (): Promise<void> => {
    if (!canAdd) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await ensureDomain()
      await setAeDomainSecret(domainId, trimmedName, value)
      setName('')
      setValue('')
      setSaves((count) => count + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-[11px] text-muted-foreground">
        {translate('pod.domain.secrets.label', 'Secrets')}
      </Label>
      {secretNames.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {secretNames.map((secretName) => (
            <li
              key={secretName}
              className="flex items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pl-2 pr-1 font-mono text-[11px]"
            >
              {secretName}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('pod.domain.secrets.remove', 'Remove {{value0}}', {
                  value0: secretName
                })}
                onClick={() => void removeAeDomainSecret(domainId, secretName)}
              >
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {unreadable.length > 0 && (
        <p role="alert" className="text-[11px] text-destructive">
          {translate(
            'pod.domain.secrets.unreadable',
            'Pod could not read {{value0}}. It was saved by Orca or by an earlier Pod, with a key this Pod no longer uses, so agents start without it. Enter the value again below and click Add to replace it.',
            { value0: unreadable.join(', ') }
          )}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value.toUpperCase())}
          placeholder="OMNI_API_KEY"
          spellCheck={false}
          className="h-7 w-44 font-mono text-xs"
        />
        <Input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={translate('pod.domain.secrets.valuePlaceholder', 'value')}
          className="h-7 flex-1 font-mono text-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void add()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!canAdd}
          onClick={() => void add()}
        >
          {translate('pod.domain.secrets.add', 'Add')}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {translate(
          'pod.domain.secrets.hint',
          'Encrypted with the OS keychain and passed to agents as environment variables. Adding one saves the form.'
        )}
      </p>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
