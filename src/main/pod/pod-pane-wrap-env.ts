/**
 * Pod: set on the PTY env by `prependOrcaCliDirToChildPath` on macOS (the bundled `bin`, or the
 * dev CLI's) and listed as an overlay key, so every macOS pane is wrapped. Orca's own restore
 * (`ORCA_CLI_POSIX_PATH_RESTORE`) runs only in wrapped panes, and a login shell's `path_helper`
 * otherwise puts stock Orca's `/usr/local/bin/orca` ahead of this app's CLI.
 */
export const BUNDLED_CLI_BIN_DIR_ENV = 'ORCA_BUNDLED_CLI_BIN_DIR'
