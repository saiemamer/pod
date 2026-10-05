/**
 * Pod brand constants. Pod is a thin fork of Orca (stablyai/orca); every upstream
 * file that names the product, app id, or release repository imports from here so a
 * rebase touches one line per file. Mirror of config/pod-brand.cjs, which
 * electron-builder reads because it cannot import TypeScript.
 */
export const POD_PRODUCT_NAME = 'Pod'
export const POD_APP_ID = 'io.github.saiemamer.pod'
/** Packaged Pod's data folder under appData; Orca's is `orca`, so both apps fit on one Mac. */
export const POD_USER_DATA_DIR_NAME = 'Pod'
/**
 * Packaged Pod's app name before `ready`, from which Electron names the macOS Keychain item
 * "Pod Safe Storage". Changing it orphans every value Pod has sealed.
 */
export const POD_KEYCHAIN_APP_NAME = 'Pod'
export const POD_RELEASE_REPO = 'saiemamer/pod'
/** Settings > Shell command and the cask link this name; `orca` stays stock Orca's. */
export const POD_SHELL_COMMAND_NAME = 'pod'
export const POD_RELEASES_URL = `https://github.com/${POD_RELEASE_REPO}/releases`
export const POD_HOMEBREW_TAP = 'saiemamer/pod'
/** The upstream Orca tag Pod is currently rebased onto. Shown next to the Pod version. */
export const POD_UPSTREAM_BASE_TAG = 'v1.4.219'
export const POD_UPSTREAM_REPO = 'stablyai/orca'
/**
 * Why: macOS only lets a signed app replace itself, and Pod is not signed yet, so packaged
 * macOS builds report updates as externally managed and the update card points at
 * `brew upgrade --cask pod`. Flip to false once releases are signed and notarized.
 */
export const POD_MAC_UPDATES_VIA_BREW = true
export const POD_BREW_UPGRADE_COMMAND = 'brew upgrade --cask pod'
/**
 * Why: Orca Mobile, Orca Cloud accounts and Orca Relay are Stably-operated services that
 * would only confuse Pod users today. Their code stays; this hides every entry point.
 * Under vitest the flag is true so upstream tests keep exercising those surfaces.
 * Flip the non-test value to true to bring them back.
 */
export const POD_SHOW_ORCA_CLOUD_FEATURES =
  typeof process !== 'undefined' && process.env?.VITEST === 'true'
/**
 * Why: Orca's built-in `--dangerously-skip-permissions` for Claude made Claude Code ask people
 * who never chose Bypass Permissions mode to confirm it. Pod starts Claude with no permission
 * argument, so Claude Code's own configuration decides. False under vitest so upstream tests
 * keep Orca's default.
 */
export const POD_CLAUDE_FOLLOWS_OWN_PERMISSIONS =
  typeof process === 'undefined' || process.env?.VITEST !== 'true'
/**
 * Why: the Mobile Emulator previews iOS simulators for app developers; it has no place in Pod.
 * Its code stays and this hides every way to open it. True under vitest, as above.
 */
export const POD_SHOW_MOBILE_EMULATOR =
  typeof process !== 'undefined' && process.env?.VITEST === 'true'
export const POD_MOBILE_EMULATOR_HIDDEN_MESSAGE = 'Pod does not include the Mobile Emulator.'
