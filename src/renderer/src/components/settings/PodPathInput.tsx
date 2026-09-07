import { useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { translate } from '@/i18n/i18n'

/**
 * Pod: a path field that commits on blur or Enter, with Browse (file or directory
 * picker) and Clear. Empty means "not set", which callers map to "look on PATH".
 */
export function PodPathInput({
  value,
  placeholder,
  pick,
  onCommit
}: {
  value: string | undefined
  placeholder: string
  pick: 'file' | 'directory'
  onCommit: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? '')
  const [seed, setSeed] = useState(value ?? '')
  if ((value ?? '') !== seed) {
    setSeed(value ?? '')
    setDraft(value ?? '')
  }
  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed !== (value ?? '')) {
      onCommit(trimmed)
    }
  }
  const browse = async (): Promise<void> => {
    const picked =
      pick === 'file'
        ? await window.api.shell.pickAttachment()
        : await window.api.shell.pickDirectory({ defaultPath: value || undefined })
    if (picked) {
      setDraft(picked)
      onCommit(picked)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(value ?? '')
            event.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        className="h-7 flex-1 font-mono text-xs"
      />
      <Button type="button" variant="outline" size="xs" onClick={() => void browse()}>
        {translate('pod.settings.path.browse', 'Browse')}
      </Button>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            setDraft('')
            onCommit('')
          }}
        >
          {translate('pod.settings.path.clear', 'Clear')}
        </Button>
      )}
    </div>
  )
}
