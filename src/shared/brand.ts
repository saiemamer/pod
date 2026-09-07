/**
 * Pod brand constants. Pod is a thin fork of Orca (stablyai/orca); every upstream
 * file that names the product, app id, or release repository imports from here so a
 * rebase touches one line per file. Mirror of config/pod-brand.cjs, which
 * electron-builder reads because it cannot import TypeScript.
 */
export const POD_PRODUCT_NAME = 'Pod'
export const POD_APP_ID = 'io.github.saiemamer.pod'
export const POD_RELEASE_REPO = 'saiemamer/pod'
export const POD_RELEASES_URL = `https://github.com/${POD_RELEASE_REPO}/releases`
export const POD_HOMEBREW_TAP = 'saiemamer/pod'
/** The upstream Orca tag Pod is currently rebased onto. Shown next to the Pod version. */
export const POD_UPSTREAM_BASE_TAG = 'v1.4.197'
export const POD_UPSTREAM_REPO = 'stablyai/orca'
/**
 * Why: macOS only lets a signed app replace itself, and Pod is not signed yet, so packaged
 * macOS builds report updates as externally managed and the update card points at
 * `brew upgrade --cask pod`. Flip to false once releases are signed and notarized.
 */
export const POD_MAC_UPDATES_VIA_BREW = true
export const POD_BREW_UPGRADE_COMMAND = 'brew upgrade --cask pod'
