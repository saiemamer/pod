import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Pod: every package Pod's main-process code imports must reach the packaged app.
 * The build copies main-process dependencies from a hard-coded root list
 * (config/packaged-runtime-node-modules.cjs) into Resources/node_modules and bundles a
 * few others into the main file; a dependency on neither list makes the packaged app
 * exit at startup with "Cannot find module", which is how 0.1.8 and 0.1.9 shipped.
 */
const projectDir = resolve(__dirname, '../../..')
const requireFromProject = createRequire(join(projectDir, 'package.json'))

/** Mirrors BUNDLED_MAIN_DEPENDENCIES in electron.vite.config.ts. */
const BUNDLED_INTO_MAIN = new Set(['@xterm/headless', '@xterm/addon-serialize', 'psl', 'zod'])
const POD_MAIN_DIRS = ['src/main/ae', 'src/main/pod', 'src/main/ipc/ae']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(path)
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

function packageNameOf(specifier: string): string {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return `${scope}/${name}`
  }
  return specifier.split('/')[0] ?? specifier
}

describe('packaged runtime dependencies of Pod main-process code', () => {
  const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  const runtimeDependencies = new Set(Object.keys(packageJson.dependencies))
  const { PACKAGED_RUNTIME_PACKAGE_ROOTS, createPackagedRuntimeNodeModuleResources } =
    requireFromProject('./config/packaged-runtime-node-modules.cjs') as {
      PACKAGED_RUNTIME_PACKAGE_ROOTS: string[]
      createPackagedRuntimeNodeModuleResources: (platform: string) => { to: string }[]
    }

  const imported = new Set<string>()
  for (const dir of POD_MAIN_DIRS) {
    for (const file of sourceFiles(join(projectDir, dir))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/from '([^'./][^']*)'/g)) {
        const name = packageNameOf(match[1] ?? '')
        if (runtimeDependencies.has(name) && !BUNDLED_INTO_MAIN.has(name)) {
          imported.add(name)
        }
      }
    }
  }

  it('finds the language-server bridge dependency', () => {
    expect([...imported]).toContain('vscode-jsonrpc')
  })

  it('lists every such dependency in the packaged root list', () => {
    const missing = [...imported].filter((name) => !PACKAGED_RUNTIME_PACKAGE_ROOTS.includes(name))
    expect(missing).toEqual([])
  })

  it('copies them into the packaged closure', () => {
    const targets = createPackagedRuntimeNodeModuleResources('darwin').map((entry) => entry.to)
    for (const name of imported) {
      expect(targets).toContain(join('node_modules', ...name.split('/')))
    }
  })
})
