/**
 * Keeps this app's own `orca` first on PATH in the terminals it opens.
 *
 * Pod's shell command is `pod`, and stock Orca may own `/usr/local/bin/orca`. The PTY env puts
 * Pod's bundled `bin` first, but a macOS login shell runs `path_helper` from `/etc/zprofile`,
 * which moves `/usr/local/bin` back in front, so agents typing `orca` would reach stock Orca.
 * The shell wrappers re-prepend the folder after the user's startup files have run.
 */

/** Set on the PTY env by `prependOrcaCliDirToChildPath` for packaged macOS builds. */
export const BUNDLED_CLI_BIN_DIR_ENV = 'ORCA_BUNDLED_CLI_BIN_DIR'

/** POSIX, so the zsh hook and both bash rcfiles share it; `-x` makes it a no-op on SSH hosts. */
export const BUNDLED_CLI_BIN_DIR_RESTORE = `# Why: a login shell's path_helper can put another app's \`orca\` ahead of this app's CLI.
if [ -n "\${ORCA_BUNDLED_CLI_BIN_DIR:-}" ] && [ -x "$ORCA_BUNDLED_CLI_BIN_DIR/orca" ]; then
  case "$PATH" in
    "$ORCA_BUNDLED_CLI_BIN_DIR"|"$ORCA_BUNDLED_CLI_BIN_DIR":*) ;;
    *) export PATH="$ORCA_BUNDLED_CLI_BIN_DIR\${PATH:+:$PATH}" ;;
  esac
fi`
