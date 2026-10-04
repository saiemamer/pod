import { POD_SHELL_COMMAND_NAME } from '../../shared/brand'

// Why `pod`: stock Orca owns `/usr/local/bin/orca`; inside Pod's terminals `orca` is still Pod's CLI.
export const DEFAULT_MAC_COMMAND_PATH = `/usr/local/bin/${POD_SHELL_COMMAND_NAME}`
export const DEV_COMMAND_NAME = 'orca-dev'
export const LEGACY_LINUX_COMMAND_NAME = 'orca'
export const DEV_LAUNCHER_DIR = ['cli', 'bin'] as const
export const WINDOWS_PATH_WRITE_TIMEOUT_MS = 5_000
