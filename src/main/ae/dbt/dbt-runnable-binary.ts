import { existsSync } from 'node:fs'
import { runProcess } from '../../../shared/child-process/run-process'
import { probeDbt, type AeSetupProbeDeps } from '../setup/ae-setup-tool-probes'
import { safeHomedir, type DbtBinary } from './dbt-runner'

/**
 * Pod: the dbt a run uses when Settings leaves the path empty. Same rule as setup detection
 * (candidates in order, the first that answers `--version`, broken shims skipped), found once
 * per session for each set of repo folders and PATH. Only a find is kept, so installing dbt
 * later works without a restart.
 */
const found = new Map<string, Promise<string | null>>()

export type DbtRunnableBinaryDeps = Partial<AeSetupProbeDeps>

export async function resolveRunnableDbtBinary(
  override: string | undefined,
  repoDirs: string[],
  env: NodeJS.ProcessEnv,
  deps: DbtRunnableBinaryDeps = {}
): Promise<DbtBinary | null> {
  const explicit = override?.trim()
  if (explicit) {
    return { path: explicit, source: 'settings' }
  }
  const key = JSON.stringify([repoDirs, env.PATH ?? ''])
  let pending = found.get(key)
  if (!pending) {
    pending = probeDbt(repoDirs, {
      run: deps.run ?? runProcess,
      env: deps.env ?? env,
      home: deps.home === undefined ? safeHomedir() : deps.home
    }).then((result) => result.binary)
    found.set(key, pending)
  }
  const path = await pending
  if (!path || !existsSync(path)) {
    found.delete(key)
    return null
  }
  return { path, source: 'path' }
}
