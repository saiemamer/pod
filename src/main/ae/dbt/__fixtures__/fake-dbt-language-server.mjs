// A stand-in for dbt-language-server: speaks LSP over stdio, answers initialize, hover,
// definition and completion with canned data, and publishes one diagnostic per didOpen.
let buffer = Buffer.alloc(0)
const send = (message) => {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
const handle = (message) => {
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        capabilities: {
          textDocumentSync: 2,
          hoverProvider: true,
          definitionProvider: true,
          completionProvider: {}
        },
        serverInfo: { name: 'fake-dbt-language-server', version: 'v9.9.9' }
      }
    })
    return
  }
  if (message.method === 'textDocument/didOpen') {
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: message.params.textDocument.uri,
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            severity: 2,
            message: 'opened',
            source: 'fake'
          }
        ]
      }
    })
    return
  }
  if (message.method === 'textDocument/hover') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        contents: {
          kind: 'markdown',
          value: `hover at ${message.params.position.line}:${message.params.position.character}`
        }
      }
    })
    return
  }
  if (message.method === 'textDocument/definition') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        uri: 'file:///tmp/project/models/stg_orders.sql',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
      }
    })
    return
  }
  if (message.method === 'textDocument/completion') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: [
        { label: 'orders', kind: 18, detail: 'Project: demo' },
        { label: 'stg_orders', kind: 18 },
        { nope: true }
      ]
    })
    return
  }
  if (message.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: null })
    return
  }
  if (message.method === 'exit') {
    process.exit(0)
  }
  if (message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, result: null })
  }
}
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) {
      return
    }
    const length = Number(
      /Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())?.[1] ?? 0
    )
    if (buffer.length < headerEnd + 4 + length) {
      return
    }
    const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString()
    buffer = buffer.subarray(headerEnd + 4 + length)
    handle(JSON.parse(body))
  }
})
if (process.argv.includes('--crash-on-start')) {
  process.stderr.write('boom: could not start\n')
  process.exit(3)
}
