import { createContext, useContext } from 'react'
import { createStore, useStore as useZustandStore, type StoreApi } from 'zustand'

/**
 * Pod: which column rows are lit and which nodes carry the name-matched footer. Kept
 * outside the node data on purpose: a column click changes fifty rows across twenty
 * nodes, and through node data that meant twenty node re-renders under React Flow's
 * synchronous store. Rows and footers subscribe here and re-render alone.
 */
export type LineageHighlightState = {
  /** Lower-cased lit column names per node id. */
  lit: ReadonlyMap<string, ReadonlySet<string>>
  /** Nodes on the lit path whose columns were matched by name. */
  footers: ReadonlySet<string>
}

export type LineageHighlightStore = StoreApi<LineageHighlightState>

const NO_COLUMNS: ReadonlySet<string> = new Set()

export function createLineageHighlightStore(): LineageHighlightStore {
  return createStore<LineageHighlightState>(() => ({ lit: new Map(), footers: new Set() }))
}

export const LineageHighlightContext = createContext<LineageHighlightStore | null>(null)

/** True while `column` on `nodeId` is on the lit path. */
export function useLineageColumnLit(nodeId: string, column: string): boolean {
  const store = useContext(LineageHighlightContext)
  const key = column.toLowerCase()
  return useZustandStore(store ?? FALLBACK, (state) =>
    (state.lit.get(nodeId) ?? NO_COLUMNS).has(key)
  )
}

/** True while `nodeId` shows the "columns matched by name" footer. */
export function useLineageNodeFooter(nodeId: string): boolean {
  const store = useContext(LineageHighlightContext)
  return useZustandStore(store ?? FALLBACK, (state) => state.footers.has(nodeId))
}

// Why a fallback: the node component can render outside the canvas (tests, storybooks),
// where nothing is lit.
const FALLBACK = createLineageHighlightStore()
