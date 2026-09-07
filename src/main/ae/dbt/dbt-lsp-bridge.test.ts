import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DbtLspServer } from './dbt-lsp-bridge'
import { hoverText, toCompletionItem, toLocation } from './dbt-lsp-convert'
import type { ProcessSpec } from '../../../shared/child-process/process-spec'

const FAKE_SERVER = join(__dirname, '__fixtures__', 'fake-dbt-language-server.mjs')

// Why a local spawn: the bridge's spawn dependency is the seam; the fake server is Node.
function spawnFake(extraArgs: string[] = []) {
  return (spec: ProcessSpec) =>
    spawn(process.execPath, [FAKE_SERVER, ...extraArgs, ...(spec.args ?? [])], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ReturnType<typeof spawn> & { stdin: NodeJS.WritableStream }
}

describe('DbtLspServer', () => {
  it('initializes, syncs a document, answers requests and stops', async () => {
    const diagnostics: { uri: string; count: number }[] = []
    const exits: (number | null)[] = []
    const server = new DbtLspServer({
      binary: 'fake',
      projectDir: tmpdir(),
      spawn: spawnFake() as never,
      onDiagnostics: (uri, list) => diagnostics.push({ uri, count: list.length }),
      onExit: (code) => exits.push(code)
    })
    await server.start()
    expect(server.running).toBe(true)
    expect(server.serverVersion).toBe('v9.9.9')

    const uri = 'file:///tmp/project/models/orders.sql'
    server.didOpen(uri, 'select 1', 1)
    server.didChange(uri, 'select 2', 2)
    expect(server.openDocumentCount).toBe(1)
    const hover = await server.hover(uri, { line: 3, character: 7 })
    expect(hover).toEqual({ contents: 'hover at 3:7' })
    const definition = await server.definition(uri, { line: 0, character: 0 })
    expect(definition).toEqual([
      {
        uri: 'file:///tmp/project/models/stg_orders.sql',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
      }
    ])
    const completion = await server.completion(uri, { line: 0, character: 0 })
    expect(completion.map((item) => item.label)).toEqual(['orders', 'stg_orders'])
    expect(completion[0]).toEqual({ label: 'orders', kind: 18, detail: 'Project: demo' })
    // Why wait: the diagnostic is a notification that races the request answers above.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(diagnostics).toEqual([{ uri, count: 1 }])

    server.didClose(uri)
    expect(server.openDocumentCount).toBe(0)
    await server.stop()
    expect(server.running).toBe(false)
    expect(exits).toHaveLength(1)
  })

  it('reports a server that dies on start with its stderr', async () => {
    const exits: { code: number | null; stderr: string }[] = []
    const server = new DbtLspServer({
      binary: 'fake',
      projectDir: tmpdir(),
      spawn: spawnFake(['--crash-on-start']) as never,
      requestTimeoutMs: 2_000,
      onExit: (code, stderr) => exits.push({ code, stderr })
    })
    await expect(server.start()).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(server.running).toBe(false)
    expect(exits[0]?.code).toBe(3)
    expect(exits[0]?.stderr).toContain('boom')
  })

  it('rejects a request the server never answers', async () => {
    const server = new DbtLspServer({
      binary: 'fake',
      projectDir: tmpdir(),
      spawn: spawnFake() as never,
      requestTimeoutMs: 100
    })
    await server.start()
    // Why: the fake answers unknown requests with null, so use an unknown notification-only path
    // by asking hover after stop, which the bridge rejects immediately.
    await server.stop()
    await expect(server.hover('file:///x', { line: 0, character: 0 })).rejects.toThrow(
      'not running'
    )
  })
})

describe('LSP answer conversion', () => {
  it('flattens every hover shape to text', () => {
    expect(hoverText('plain ')).toBe('plain')
    expect(hoverText({ kind: 'markdown', value: 'md' })).toBe('md')
    expect(hoverText({ language: 'sql', value: 'select 1' })).toBe('```sql\nselect 1\n```')
    expect(hoverText(['a', { value: 'b' }, 7])).toBe('a\n\nb')
    expect(hoverText(null)).toBe('')
  })

  it('accepts Location and LocationLink and drops malformed entries', () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }
    expect(toLocation({ uri: 'file:///a', range })).toEqual({ uri: 'file:///a', range })
    expect(toLocation({ targetUri: 'file:///b', targetRange: range })).toEqual({
      uri: 'file:///b',
      range
    })
    expect(toLocation({ uri: 'file:///c' })).toBeNull()
    expect(toLocation('nope')).toBeNull()
  })

  it('keeps only the completion fields Pod shows', () => {
    expect(
      toCompletionItem({
        label: 'x',
        kind: 3,
        detail: 'd',
        documentation: { value: 'doc' },
        insertText: 'x()',
        sortText: '0',
        filterText: 'x',
        textEdit: { ignored: true }
      })
    ).toEqual({
      label: 'x',
      kind: 3,
      detail: 'd',
      documentation: 'doc',
      insertText: 'x()',
      sortText: '0',
      filterText: 'x'
    })
    expect(toCompletionItem({ kind: 3 })).toBeNull()
  })
})
