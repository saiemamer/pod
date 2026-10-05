import { PROTECTED_SECRET_SLOT } from '../protected-secret-persistence'
import type { PodUnreadableSetting } from '../../shared/ae/pod-unreadable-types'

const SETTING_BY_SLOT: ReadonlyMap<string, PodUnreadableSetting> = new Map([
  [PROTECTED_SECRET_SLOT.opencodeGoApiKey, 'opencodeGoApiKey'],
  [PROTECTED_SECRET_SLOT.opencodeSessionCookie, 'opencodeSessionCookie'],
  [PROTECTED_SECRET_SLOT.httpProxyUrl, 'httpProxyUrl'],
  [PROTECTED_SECRET_SLOT.browserKagiSessionLink, 'browserKagiSessionLink']
])

/**
 * Pod: the saved settings a person typed whose sealed value this key cannot open. SSH recovery
 * leases are left out; Pod writes those itself and nobody can enter them.
 */
export function unreadableSettings(slots: readonly string[]): PodUnreadableSetting[] {
  return slots.flatMap((slot) => {
    const setting = SETTING_BY_SLOT.get(slot)
    return setting ? [setting] : []
  })
}
