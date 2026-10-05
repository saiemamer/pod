/**
 * Real-shell proof that `orca` in a terminal Pod opens runs Pod's own CLI, even when the
 * login startup files put stock Orca's `/usr/local/bin/orca` first (what macOS path_helper
 * does). The user's `.zprofile` / `.bash_profile` here prepends a stand-in stock folder.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prependOrcaCliDirToChildPath } from '../cli/orca-cli-child-path'
import { getShellLaunchConfig as getDaemonShellLaunchConfig } from '../daemon/shell-ready'
import { getShellLaunchConfig as getLocalShellLaunchConfig } from '../providers/local-pty-shell-ready'
import { selectShellStartupFeatures } from '../shell-startup-features'

const hasShell = (shell: string): boolean =>
  process.platform !== 'win32' && spawnSync(shell, ['--version']).status === 0

function writeOrca(binDir: string, says: string): void {
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'orca'), `#!/bin/sh\necho ${says}\n`, { mode: 0o755 })
}

const LAUNCHERS = {
  local: getLocalShellLaunchConfig,
  daemon: (shell: string, features: Parameters<typeof getLocalShellLaunchConfig>[1]) =>
    getDaemonShellLaunchConfig(shell, features)
} as const

describe.skipIf(process.platform === 'win32')('orca inside a Pod terminal', () => {
  let root = ''
  let previousUserDataPath: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pod-cli-path-'))
    previousUserDataPath = process.env.ORCA_USER_DATA_PATH
    process.env.ORCA_USER_DATA_PATH = join(root, 'userData')
  })

  afterEach(() => {
    if (previousUserDataPath === undefined) {
      delete process.env.ORCA_USER_DATA_PATH
    } else {
      process.env.ORCA_USER_DATA_PATH = previousUserDataPath
    }
    rmSync(root, { recursive: true, force: true })
  })

  const cases = (['zsh', 'bash'] as const).flatMap((shell) =>
    (['local', 'daemon'] as const).flatMap((transport) =>
      (['packaged', 'dev'] as const).map((build) => [shell, transport, build] as const)
    )
  )

  it.each(cases)(
    '%s (%s, %s build) runs Pod’s orca after the login PATH puts stock first',
    (shell, transport, build) => {
      if (!hasShell(shell)) {
        return
      }
      const home = join(root, 'home')
      const stockBin = join(root, 'usr-local-bin')
      const resourcesPath = join(root, 'Pod.app', 'Contents', 'Resources')
      writeOrca(stockBin, 'STOCK_ORCA')
      const userDataPath = process.env.ORCA_USER_DATA_PATH!
      // Why: a dev build's `orca` is the launcher pnpm build:cli writes under userData.
      writeOrca(
        build === 'packaged' ? join(resourcesPath, 'bin') : join(userDataPath, 'cli', 'bin'),
        'POD_ORCA'
      )
      mkdirSync(home, { recursive: true })
      const profile = `export PATH="${stockBin}:$PATH"\n`
      writeFileSync(join(home, shell === 'zsh' ? '.zprofile' : '.bash_profile'), profile)

      // The PTY env Pod builds for a plain pane: no startup command, no readiness wait.
      const env: Record<string, string> = { HOME: home, PATH: '/usr/bin:/bin' }
      prependOrcaCliDirToChildPath(env, {
        isPackaged: build === 'packaged',
        userDataPath,
        resourcesPath,
        platform: 'darwin'
      })
      const shellPath = spawnSync('sh', ['-c', `command -v ${shell}`], {
        encoding: 'utf8'
      }).stdout.trim()
      const features = selectShellStartupFeatures({
        shellPath,
        env,
        hasStartupCommand: false,
        waitsForShellReady: false,
        emitsStartupIdentity: false
      })
      const launch = LAUNCHERS[transport](shellPath, features)

      // Why `-l` when unwrapped: that is what Pod's PTY launch plans fall back to.
      const result = spawnSync(shellPath, [...(launch.args ?? ['-l']), '-i'], {
        // Why ORCA_ORIG_ZDOTDIR: the wrapper hands ZDOTDIR back to it, and it must be the sandbox home.
        env: { ...env, ...launch.env, ORCA_ORIG_ZDOTDIR: home },
        cwd: home,
        // Why stdin: an interactive zsh still runs its precmd hooks, where the wrapper's restores live.
        input: 'orca\nexit\n',
        encoding: 'utf8',
        timeout: 20_000
      })

      expect(result.stdout).toContain('POD_ORCA')
      expect(result.stdout).not.toContain('STOCK_ORCA')
    }
  )
})
