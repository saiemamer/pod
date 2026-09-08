import { useEffect, useRef, useState } from 'react'
import type { LineageLayoutResult } from './lineage-layout'

export type LineagePositions = Record<string, { x: number; y: number }>

const TWEEN_MS = 220

/** cubic-bezier(0.16, 1, 0.3, 1), the app's reveal curve, solved for a time fraction. */
export function reveal(t: number): number {
  // Why solve: CSS easing names are not available to a requestAnimationFrame loop.
  const p1x = 0.16
  const p1y = 1
  const p2x = 0.3
  const p2y = 1
  const sample = (a: number, b: number, u: number): number =>
    3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u
  let lo = 0
  let hi = 1
  let u = t
  for (let i = 0; i < 24; i += 1) {
    const x = sample(p1x, p2x, u)
    if (Math.abs(x - t) < 0.0005) {
      break
    }
    if (x < t) {
      lo = u
    } else {
      hi = u
    }
    u = (lo + hi) / 2
  }
  return sample(p1y, p2y, u)
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

/**
 * Pod: node positions that glide to a new layout instead of jumping. The first layout
 * and nodes new to it land in place; positions are updated through React state so the
 * edges React Flow draws from them travel along.
 */
export function useTweenedPositions(target: LineageLayoutResult): LineagePositions {
  const shown = useRef<LineagePositions>({})
  const [, setTick] = useState(0)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const from: LineagePositions = {}
    const to: LineagePositions = {}
    let moving = false
    for (const [id, box] of Object.entries(target)) {
      const current = shown.current[id]
      to[id] = { x: box.x, y: box.y }
      if (current && (current.x !== box.x || current.y !== box.y)) {
        from[id] = current
        moving = true
      }
    }
    for (const id of Object.keys(shown.current)) {
      if (!(id in target)) {
        delete shown.current[id]
      }
    }
    if (!moving || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      shown.current = { ...shown.current, ...to }
      setTick((n) => n + 1)
      return
    }
    const started = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / TWEEN_MS)
      const k = reveal(t)
      const next: LineagePositions = { ...shown.current }
      for (const [id, end] of Object.entries(to)) {
        const start = from[id]
        next[id] = start
          ? { x: start.x + (end.x - start.x) * k, y: start.y + (end.y - start.y) * k }
          : end
      }
      shown.current = next
      setTick((n) => n + 1)
      frame.current = t < 1 ? requestAnimationFrame(step) : null
    }
    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current)
        frame.current = null
      }
    }
  }, [target])

  return shown.current
}
