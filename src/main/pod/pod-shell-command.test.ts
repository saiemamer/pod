/**
 * Settings > Shell command installs Pod as `pod`, so turning it on never re-points stock
 * Orca's `orca` link. The default path is replayed under a temp root; nothing touches the
 * real /usr/local/bin.
 */
import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CliInstaller } from '../cli/cli-installer'
import { DEFAULT_MAC_COMMAND_PATH } from '../cli/cli-install-constants'

async function writeLauncher(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '#!/bin/sh\n', { mode: 0o755 })
}

describe.skipIf(process.platform === 'win32')('Pod shell command on macOS', () => {
  let root = ''
  let resourcesPath = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pod-shell-command-'))
    resourcesPath = join(root, 'Pod.app', 'Contents', 'Resources')
    await writeLauncher(join(resourcesPath, 'bin', 'orca'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function installer(defaultMacCommandPath: string, homePath: string): CliInstaller {
    return new CliInstaller({
      platform: 'darwin',
      isPackaged: true,
      resourcesPath,
      userDataPath: join(root, 'userData'),
      execPath: join(root, 'Pod.app', 'Contents', 'MacOS', 'Pod'),
      appPath: join(root, 'app'),
      homePath,
      defaultMacCommandPath,
      processPathEnv: join(defaultMacCommandPath, '..')
    })
  }

  it('installs pod next to stock Orca’s orca link and leaves that link alone', async () => {
    const commandPath = join(root, DEFAULT_MAC_COMMAND_PATH)
    const binDir = join(commandPath, '..')
    const stockLauncher = join(root, 'Orca.app', 'Contents', 'Resources', 'bin', 'orca')
    await writeLauncher(stockLauncher)
    await mkdir(binDir, { recursive: true })
    await symlink(stockLauncher, join(binDir, 'orca'))

    const installed = await installer(commandPath, join(root, 'home')).install()

    expect(installed.state).toBe('installed')
    expect(installed.commandName).toBe('pod')
    expect(installed.commandPath).toBe(join(binDir, 'pod'))
    expect(await readlink(join(binDir, 'pod'))).toBe(join(resourcesPath, 'bin', 'orca'))
    expect(await readlink(join(binDir, 'orca'))).toBe(stockLauncher)
  })

  it('falls back to ~/.local/bin/pod when /usr/local/bin is absent', async () => {
    const homePath = join(root, 'home')
    const absent = join(root, 'absent', DEFAULT_MAC_COMMAND_PATH)

    const status = await installer(absent, homePath).getStatus()

    expect(status.commandName).toBe('pod')
    expect(status.commandPath).toBe(join(homePath, '.local', 'bin', 'pod'))
    await expect(lstat(join(homePath, '.local', 'bin', 'orca'))).rejects.toThrow()
  })
})
