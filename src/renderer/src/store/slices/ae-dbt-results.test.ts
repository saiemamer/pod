import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AppState } from '../types'
import { createAeDbtResultsSlice, type AeDbtResultsSlice } from './ae-dbt-results'

const show = vi.fn()
const compile = vi.fn()
const project = vi.fn()

function makeStore() {
  return create<AeDbtResultsSlice>()((set, get, api) =>
    createAeDbtResultsSlice(set as never, get as unknown as () => AppState, api as never)
  )
}

beforeEach(() => {
  show.mockReset()
  compile.mockReset()
  project.mockReset()
  ;(globalThis as { window?: unknown }).window = {
    api: { ae: { dbt: { show, compile, project } } }
  }
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const file = { fileId: 'f1', filePath: '/repo/models/orders.sql' }

describe('createAeDbtResultsSlice', () => {
  it('records a show run and keeps only the newest answer', async () => {
    const store = makeStore()
    let resolveFirst: (value: unknown) => void = () => {}
    show.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const first = store.getState().runAeDbt({ ...file, kind: 'show', target: { model: 'orders' } })
    expect(store.getState().aeDbtResults.f1).toMatchObject({
      status: 'running',
      label: 'orders',
      view: 'table',
      collapsed: false
    })
    show.mockResolvedValueOnce({ columns: ['n'], rows: [[2]], rowCount: 1, limit: 500 })
    await store.getState().runAeDbt({ ...file, kind: 'show', target: { sql: 'select 2 as n' } })
    expect(store.getState().aeDbtResults.f1).toMatchObject({
      status: 'done',
      label: 'select 2 as n'
    })
    resolveFirst({ columns: ['n'], rows: [[1]], rowCount: 1, limit: 500 })
    await first
    expect(store.getState().aeDbtResults.f1?.show?.rows).toEqual([[2]])
    expect(show).toHaveBeenLastCalledWith({
      path: file.filePath,
      sql: 'select 2 as n',
      limit: undefined
    })
  })

  it('stores compile output under the compiled view and errors without the IPC wrapper', async () => {
    const store = makeStore()
    compile.mockResolvedValueOnce({ sql: 'select 1', durationMs: 10, command: 'dbt compile' })
    await store.getState().runAeDbt({ ...file, kind: 'compile', target: { model: 'orders' } })
    expect(store.getState().aeDbtResults.f1).toMatchObject({
      status: 'done',
      view: 'compiled',
      compile: { sql: 'select 1' }
    })
    compile.mockRejectedValueOnce(
      new Error("Error invoking remote method 'ae:dbt:compile': Error: Compilation Error in x")
    )
    await store.getState().runAeDbt({ ...file, kind: 'compile', target: { model: 'orders' } })
    expect(store.getState().aeDbtResults.f1).toMatchObject({
      status: 'error',
      error: 'Compilation Error in x'
    })
  })

  it('switches views, collapses, loads the project summary and closes', async () => {
    const store = makeStore()
    show.mockResolvedValueOnce({ columns: [], rows: [], rowCount: 0, limit: 500 })
    await store.getState().runAeDbt({ ...file, kind: 'show', target: { model: 'orders' } })
    store.getState().setAeDbtView('f1', 'connection')
    store.getState().toggleAeDbtCollapsed('f1')
    expect(store.getState().aeDbtResults.f1).toMatchObject({ view: 'connection', collapsed: true })
    project.mockResolvedValueOnce({ project: { name: 'demo' } })
    await store.getState().loadAeDbtProject('f1', file.filePath)
    expect(store.getState().aeDbtResults.f1?.project).toEqual({ project: { name: 'demo' } })
    store.getState().closeAeDbtResults('f1')
    expect(store.getState().aeDbtResults).toEqual({})
  })
})
