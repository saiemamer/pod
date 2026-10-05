import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import {
  POD_UNREADABLE_SETTING_LABELS,
  type PodUnreadableSetting
} from '../../../shared/ae/pod-unreadable-types'

/**
 * Pod: asks again for a saved setting sealed with a key Pod cannot open (Orca's, or an earlier
 * Pod's). Shown beside the field; gone once the person enters a value.
 */
export function PodUnreadableSettingNotice({
  setting,
  value
}: {
  setting: PodUnreadableSetting
  value: string | null | undefined
}): React.JSX.Element | null {
  const [unreadable, setUnreadable] = useState<PodUnreadableSetting[]>([])
  const hasValue = Boolean(value)

  useEffect(() => {
    const settings = typeof window !== 'undefined' ? window.api?.ae?.settings : undefined
    if (!settings) {
      return
    }
    let cancelled = false
    void settings
      .unreadableSecrets()
      .then((found) => {
        if (!cancelled) {
          setUnreadable(found)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hasValue])

  if (hasValue || !unreadable.includes(setting)) {
    return null
  }
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground"
    >
      {translate(
        'pod.settings.unreadableSecret',
        'Pod could not read your saved {{value0}}. Orca or an earlier Pod saved it with a key this Pod no longer uses. Enter it again here; the old copy is kept until you save a new one.',
        { value0: POD_UNREADABLE_SETTING_LABELS[setting] }
      )}
    </p>
  )
}
