import { runProcess } from '../../../shared/child-process/run-process'
import { resolveProfileLoadingShell } from '../../startup/hydrate-shell-path'

/**
 * Pod: the few variables setup needs as the user's terminal sees them. Pod opened from
 * the Dock inherits launchd's env, where OMNI_BASE_URL and DBT_PROFILES_DIR are unset.
 * Token values stay in the main process; detection reports only whether one is set.
 */
const NAMES = [
  'PATH',
  'OMNI_BASE_URL',
  'OMNI_API_TOKEN',
  'OMNI_API_KEY',
  'OMNI_CONFIG_PATH',
  'OMNI_CONFIG_DIR',
  'DBT_PROFILES_DIR',
  'XDG_CONFIG_HOME'
] as const
const MARK = '__POD_SETUP_ENV__'

export async function readLoginShellEnv(
  base: NodeJS.ProcessEnv = process.env
): Promise<NodeJS.ProcessEnv> {
  const shell = process.platform === 'win32' ? null : resolveProfileLoadingShell()
  if (!shell) {
    return base
  }
  const script = [
    ...NAMES.map((name) => `printf '%s%s=%s\\n' '${MARK}' '${name}' "$${name}"`),
    'true'
  ].join('; ')
  try {
    const result = await runProcess({
      program: shell,
      args: ['-ilc', script],
      env: base,
      timeoutMs: 15_000,
      maxOutputBytes: 1024 * 1024
    })
    const env: NodeJS.ProcessEnv = { ...base }
    for (const line of result.stdout.split('\n')) {
      const start = line.indexOf(MARK)
      if (start === -1) {
        continue
      }
      const pair = line.slice(start + MARK.length)
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1).trim()
      if (value) {
        env[name] = value
      }
    }
    return env
  } catch {
    return base
  }
}
