import { app } from 'electron'
import { POD_MAC_UPDATES_VIA_BREW } from '../../shared/brand'

/**
 * Packaged macOS Pod cannot install its own updates while unsigned; Homebrew does it.
 * Why the execPath check: upstream tests run on macOS with a mocked packaged app, and
 * only a real bundle executes from Contents/MacOS.
 */
export function isBrewManagedPodInstall(): boolean {
  return (
    POD_MAC_UPDATES_VIA_BREW &&
    process.platform === 'darwin' &&
    app.isPackaged === true &&
    process.execPath.includes('.app/Contents/MacOS/')
  )
}
