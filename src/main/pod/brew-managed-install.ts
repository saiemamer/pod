import { app } from 'electron'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  POD_BREW_UPGRADE_COMMAND,
  POD_MAC_UPDATES_VIA_BREW,
  POD_PRODUCT_NAME
} from '../../shared/brand'

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

/**
 * A .command file opens in Terminal on double-click (and via shell.openPath), which
 * runs the upgrade without asking the user to type it or granting automation access.
 */
export function writeBrewUpgradeScript(): string | null {
  if (!isBrewManagedPodInstall()) {
    return null
  }
  const path = join(app.getPath('userData'), 'pod-upgrade.command')
  const script = [
    '#!/bin/zsh',
    `echo "Updating ${POD_PRODUCT_NAME} with Homebrew..."`,
    `${POD_BREW_UPGRADE_COMMAND} || echo "Upgrade failed. Try: brew reinstall --cask saiemamer/pod/pod"`,
    'xattr -dr com.apple.quarantine /Applications/Pod.app 2>/dev/null',
    'echo',
    `echo "Done. Quit ${POD_PRODUCT_NAME} and open it again to run the new version."`,
    ''
  ].join('\n')
  try {
    writeFileSync(path, script, 'utf8')
    chmodSync(path, 0o755)
    return path
  } catch {
    return null
  }
}

/** Spread into the update-available status so the card can offer the one-click upgrade. */
export function podBrewUpgradeScriptField(): { podBrewUpgradeScript?: string } {
  const script = writeBrewUpgradeScript()
  return script ? { podBrewUpgradeScript: script } : {}
}
