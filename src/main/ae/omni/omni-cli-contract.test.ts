import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import { findOnPath } from '../dbt/dbt-runner'
import {
  commitArgs,
  createBranchArgs,
  getTopicArgs,
  listModelsArgs,
  listTopicsArgs,
  validateArgs
} from './omni-branches'
import { buildOmniCommandArgs } from './omni-runner'

/**
 * Every command Pod sends, checked against the Omni CLI's own help: the 1.0.4 help
 * recorded in `fixtures/omni-cli-1.0.4/`, and a real `omni` when one is installed
 * (`POD_OMNI_CLI`, else PATH). A misspelt flag fails here instead of on a laptop.
 */
const M = '11111111-1111-4111-8111-111111111111'
const B = 'b0000000-0000-4000-8000-000000000001'

const POD_COMMANDS: string[][] = [
  listModelsArgs({}),
  listModelsArgs({ cursor: 'next' }),
  listModelsArgs({ modelId: M, withBranches: true }),
  createBranchArgs(M, 'opencx-tickets'),
  validateArgs(M, null),
  validateArgs(M, B),
  commitArgs(M, B, 'Add channel'),
  listTopicsArgs(M, null),
  listTopicsArgs(M, B),
  getTopicArgs(M, 'tickets', null),
  getTopicArgs(M, 'tickets', B)
].map(buildOmniCommandArgs)

type CobraHelp = {
  /** Positional placeholders after the command path, `<x>` required and `[x]` optional. */
  required: number
  optional: number
  commands: string[]
  /** Flag name to whether it takes a value. */
  flags: Map<string, boolean>
}

function parseCobraHelp(text: string): CobraHelp {
  const lines = text.split('\n')
  const usageAt = lines.findIndex((line) => line.trim() === 'Usage:')
  const usage = (lines[usageAt + 1] ?? '').trim().split(/\s+/)
  const placeholders = usage.filter((token) => /^[<[]/.test(token) && token !== '[flags]')
  const commands: string[] = []
  const flags = new Map<string, boolean>()
  let section = ''
  for (const line of lines) {
    if (/^\S.*:$/.test(line)) {
      section = line
      continue
    }
    if (section === 'Available Commands:') {
      const name = line.trim().split(/\s+/)[0]
      if (name) {
        commands.push(name)
      }
    }
    const flag = /^\s+(?:-\w, )?--([\w-]+)(?: (\w+))?\s{2,}/.exec(line)
    if (flag && section.endsWith('Flags:')) {
      flags.set(flag[1], Boolean(flag[2]))
    }
  }
  return {
    required: placeholders.filter((token) => token.startsWith('<')).length,
    optional: placeholders.filter((token) => token.startsWith('[')).length,
    commands,
    flags
  }
}

/** Problems with one argv against the help of the commands it names; empty when it fits. */
async function checkArgv(
  argv: string[],
  helpFor: (path: string[]) => Promise<string>
): Promise<string[]> {
  const path: string[] = []
  let help = parseCobraHelp(await helpFor(path))
  let at = 0
  while (at < argv.length && !argv[at].startsWith('-') && help.commands.length > 0) {
    if (!help.commands.includes(argv[at])) {
      return [`no command "${[...path, argv[at]].join(' ')}"`]
    }
    path.push(argv[at])
    help = parseCobraHelp(await helpFor(path))
    at += 1
  }
  const problems: string[] = []
  let positionals = 0
  for (; at < argv.length; at += 1) {
    const token = argv[at]
    if (!token.startsWith('-')) {
      positionals += 1
      continue
    }
    const name = token.replace(/^--?/, '').split('=')[0]
    const takesValue = help.flags.get(name)
    if (takesValue === undefined && !(token === '--version' && path.length === 0)) {
      problems.push(`omni ${path.join(' ')} has no flag ${token}`)
    }
    // Why an unknown flag also eats a value: one wrong flag should be one problem.
    const valueFollows = takesValue ?? !argv[at + 1]?.startsWith('-')
    if (valueFollows && !token.includes('=')) {
      at += 1
    }
  }
  if (positionals < help.required || positionals > help.required + help.optional) {
    problems.push(
      `omni ${path.join(' ')} takes ${help.required} argument(s), Pod passed ${positionals}`
    )
  }
  return problems
}

const FIXTURES = join(__dirname, 'fixtures', 'omni-cli-1.0.4')

async function fixtureHelp(path: string[]): Promise<string> {
  return readFileSync(join(FIXTURES, `${path.length ? path.join('-') : 'root'}.txt`), 'utf8')
}

describe('Pod’s Omni commands against the Omni CLI 1.0.4 help', () => {
  it.each(POD_COMMANDS.map((argv) => [argv.slice(0, 2).join(' '), argv]))(
    'omni %s fits',
    async (_name, argv) => {
      expect(await checkArgv(argv, fixtureHelp)).toEqual([])
    }
  )

  it('catches the flag Pod 0.1.13 sent', async () => {
    expect(await checkArgv(['models', 'list', '--page-size', '100'], fixtureHelp)).toEqual([
      'omni models list has no flag --page-size'
    ])
  })

  it('covers the version probe setup runs', async () => {
    expect(await checkArgv(['--version'], fixtureHelp)).toEqual([])
  })
})

const realOmni = process.env.POD_OMNI_CLI?.trim() || findOnPath('omni', process.env.PATH)

describe.skipIf(!realOmni)('Pod’s Omni commands against the installed omni', () => {
  it('fits every command (help only, no network)', async () => {
    // Why an empty HOME and no OMNI_ variables: `--help` must not read a real profile.
    const home = mkdtempSync(join(tmpdir(), 'pod-omni-contract-'))
    try {
      const seen = new Map<string, Promise<string>>()
      const run = async (path: string[]): Promise<string> => {
        const result = await runProcess({
          program: realOmni ?? 'omni',
          args: [...path, '--help'],
          env: { PATH: process.env.PATH, HOME: home },
          timeoutMs: 20_000,
          maxOutputBytes: 1024 * 1024
        })
        return result.stdout
      }
      const helpFor = (path: string[]): Promise<string> => {
        const key = path.join(' ')
        const cached = seen.get(key) ?? run(path)
        seen.set(key, cached)
        return cached
      }
      for (const argv of POD_COMMANDS) {
        expect(await checkArgv(argv, helpFor), argv.join(' ')).toEqual([])
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 120_000)
})
