import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLI_MAIN_ENTRY_NAMES } from '../../../config/build-plugins/plain-node-entry-guard'

/**
 * Only the main process (desktop and `orca serve`) runs the startup that points the six credential
 * stores at `~/.pod`. Any other process that loaded one would read and write Orca's `~/.orca`, so
 * walk every shipped entry's imports and allow the stores only from the main process and orcad.
 */
const REPO = path.resolve(import.meta.dirname, '../../..')
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs']
const CREDENTIAL_FOLDER = path.join(REPO, 'src/main/pod/pod-credential-folder.ts')
const MAIN_PROCESS_ENTRY = 'src/main/index.ts'
// Why allowed: electron-builder leaves out/orcad out of the app; it runs on SSH and WSL hosts,
// where its secret store never seals, so it cannot write a value sealed with Pod's key.
const ORCAD_ENTRY = 'src/main/orcad/main.ts'

function electronViteEntries(): string[] {
  const config = readFileSync(path.join(REPO, 'electron.vite.config.ts'), 'utf8')
  const literal = [...config.matchAll(/resolve\('(src\/main\/[^']+\.ts)'\)/g)].map((m) => m[1])
  return [...literal, ...CLI_MAIN_ENTRY_NAMES.map((name) => `src/main/${name}.ts`)]
}

function relayEntries(): string[] {
  const script = readFileSync(path.join(REPO, 'config/scripts/build-relay.mjs'), 'utf8')
  return [...script.matchAll(/join\(\s*ROOT,\s*((?:'[^']+',?\s*)+)\)/g)]
    .map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((part) => part[1]).join('/'))
    .filter((file) => file.startsWith('src/') && file.endsWith('.ts'))
}

const ENTRIES = [
  ...new Set([...electronViteEntries(), ...relayEntries(), 'src/cli/index.ts', ORCAD_ENTRY])
]

/** `import`/`export ... from`, `import(...)` and `require(...)` specifiers, minus type-only ones. */
function valueImportSpecifiers(source: string): string[] {
  const pattern =
    /(?:^|[\s;}])(?:import|export)(\s+type\s|\s*\{[^}]*\}|[^'"]*?)?\s*from\s*['"]([^'"]+)['"]|(?:^|[\s;}])import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g
  const specifiers: string[] = []
  for (const match of source.matchAll(pattern)) {
    const clause = match[1] ?? ''
    const specifier = match[2] ?? match[3] ?? match[4] ?? match[5]
    if (!specifier || /^\s*type\s/.test(clause)) {
      continue
    }
    const bindings = clause.trim().startsWith('{') ? clause.trim().slice(1, -1).split(',') : null
    if (bindings && bindings.some((b) => b.trim()) && bindings.every((b) => /^\s*type\s/.test(b))) {
      continue
    }
    specifiers.push(specifier)
  }
  return specifiers
}

function resolveRelative(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('.')) {
    return null
  }
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [
    ...(/\.[cm]?[jt]sx?$/.test(base) ? [base] : []),
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`))
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** The import chain from `entry` to the credential folder module, or null when none exists. */
function chainToCredentialFolder(entry: string): string[] | null {
  const start = path.join(REPO, entry)
  const chains = new Map([[start, [start]]])
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.shift() ?? ''
    const chain = chains.get(file) ?? []
    if (file === CREDENTIAL_FOLDER) {
      return chain.map((step) => path.relative(REPO, step))
    }
    for (const specifier of valueImportSpecifiers(readFileSync(file, 'utf8'))) {
      const resolved = resolveRelative(specifier, file)
      if (resolved && !chains.has(resolved)) {
        chains.set(resolved, [...chain, resolved])
        queue.push(resolved)
      }
    }
  }
  return null
}

describe('processes that can load a credential store', () => {
  it('finds every shipped entry', () => {
    expect(ENTRIES).toContain(MAIN_PROCESS_ENTRY)
    expect(ENTRIES).toContain('src/main/daemon/daemon-entry.ts')
    expect(ENTRIES).toContain('src/relay/relay.ts')
    for (const entry of ENTRIES) {
      expect(existsSync(path.join(REPO, entry)), entry).toBe(true)
    }
  })

  it('include the main process, which points the stores at ~/.pod before ready', () => {
    expect(chainToCredentialFolder(MAIN_PROCESS_ENTRY)).toContain(
      'src/main/pod/pod-credential-copy.ts'
    )
  })

  it.each(ENTRIES.filter((entry) => entry !== MAIN_PROCESS_ENTRY && entry !== ORCAD_ENTRY))(
    'exclude %s',
    (entry) => {
      expect(chainToCredentialFolder(entry)).toBeNull()
    }
  )

  it('leave orcad out of the packaged app', () => {
    const builderConfig = readFileSync(
      path.join(REPO, 'config/electron-builder.config.cjs'),
      'utf8'
    )
    expect(builderConfig).toContain("'!out/orcad{,/**/*}'")
  })
})
