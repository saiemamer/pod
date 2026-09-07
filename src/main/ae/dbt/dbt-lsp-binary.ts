import type { DbtLspStatus } from '../../../shared/ae/dbt-lsp-types'
import type { DbtContext } from './dbt-context'
import {
  DbtLspUnavailableError,
  ensureDbtLspBinary,
  type DbtLspDownloadDeps
} from './dbt-lsp-download'
import { findOnPath } from './dbt-runner'

/**
 * Pod: which dbt-language-server to run. Settings win, then the pinned download, then
 * a copy on PATH when the download cannot happen (offline, unsupported platform).
 */
export type DbtLspBinary = { path: string; source: NonNullable<DbtLspStatus['binarySource']> }

export async function resolveDbtLspBinary(
  context: DbtContext,
  download: DbtLspDownloadDeps
): Promise<DbtLspBinary> {
  const override = context.toolOverrides.dbtLsp?.trim()
  if (override) {
    return { path: override, source: 'settings' }
  }
  try {
    return { path: await ensureDbtLspBinary(download), source: 'download' }
  } catch (error) {
    const onPath = findOnPath('dbt-language-server', context.env.PATH)
    if (onPath) {
      return { path: onPath, source: 'path' }
    }
    throw error instanceof DbtLspUnavailableError ? error : new Error(String(error))
  }
}
