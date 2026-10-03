import { describe, expect, it } from 'vitest'
import type { LineageLayoutResult } from './lineage-layout'
import {
  lineageAnchorOffset,
  lineageExpansionMerged,
  shiftLineageLayout,
  type LineageAnchorHold
} from './use-lineage-anchored-layout'

const box = (x: number, y = 0): LineageLayoutResult[string] => ({ x, y, width: 232, height: 102 })

// Hiding stg's parent (the source) moves stg into the source's column.
const before: LineageLayoutResult = { source: box(0), stg: box(328), orders: box(656) }
const after: LineageLayoutResult = { stg: box(0), orders: box(328) }
const hold: LineageAnchorHold = { id: 'stg', at: { x: 328, y: 0 }, layout: before }

describe('lineageAnchorOffset', () => {
  it('offsets the new layout so the clicked node keeps its spot', () => {
    const offset = lineageAnchorOffset(hold, after, {}, { x: 0, y: 0 })
    expect(offset).toEqual({ x: 328, y: 0 })
    expect(shiftLineageLayout(after, offset!).stg).toMatchObject({ x: 328, y: 0 })
    expect(shiftLineageLayout(after, offset!).orders).toMatchObject({ x: 656, y: 0 })
  })

  it('adds to an offset already in place', () => {
    const restored: LineageLayoutResult = { source: box(0), stg: box(328), orders: box(656) }
    const held = { ...hold, layout: after }
    // stg sits at 0 + 328 on screen; restoring moves it to 328 + 328, so the offset drops back.
    expect(lineageAnchorOffset(held, restored, {}, { x: 328, y: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('leaves the layout alone for a dragged node, which ignores the layout', () => {
    expect(lineageAnchorOffset(hold, after, { stg: { x: 328, y: 80 } }, { x: 0, y: 0 })).toBe(null)
  })

  it('leaves the layout alone when the node did not move or is gone', () => {
    expect(lineageAnchorOffset(hold, before, {}, { x: 0, y: 0 })).toBeNull()
    expect(lineageAnchorOffset(hold, { orders: box(0) }, {}, { x: 0, y: 0 })).toBeNull()
  })
})

describe('shiftLineageLayout', () => {
  it('returns the same object without an offset, so memoised consumers keep it', () => {
    expect(shiftLineageLayout(after, { x: 0, y: 0 })).toBe(after)
  })
})

describe('lineageExpansionMerged', () => {
  it('holds only for an expansion that merged', async () => {
    expect(await lineageExpansionMerged(Promise.resolve(true))).toBe(true)
    expect(await lineageExpansionMerged(Promise.resolve(false))).toBe(false)
    expect(await lineageExpansionMerged(Promise.reject(new Error('no manifest')))).toBe(false)
  })
})
