import type { OrcaProfileAuthStatus } from '../../../../shared/orca-profiles'
import { POD_SHOW_ORCA_CLOUD_FEATURES } from '../../../../shared/brand' // Pod

export type UnexpectedSignoutGate = {
  authStatus: OrcaProfileAuthStatus | null
  persistedUIReady: boolean
  appVersion: string | null
  dismissedVersion: string | null
}

export function shouldShowUnexpectedSignoutCard(gate: UnexpectedSignoutGate): boolean {
  if (!gate.persistedUIReady || gate.appVersion === null) {
    return false
  }
  if (gate.dismissedVersion !== null) {
    return false
  }
  return (
    POD_SHOW_ORCA_CLOUD_FEATURES &&
    gate.authStatus?.configured === true &&
    gate.authStatus.state === 'reconnect-required' &&
    gate.authStatus.cloud != null
  )
}
