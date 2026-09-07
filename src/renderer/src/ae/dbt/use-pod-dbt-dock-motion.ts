import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PodDbtDockView } from '@/store/slices/ae-dbt-results'

/** Tab order, which also decides which way the body flies in. */
export const POD_DBT_DOCK_VIEWS: readonly PodDbtDockView[] = [
  'table',
  'compiled',
  'lineage',
  'connection'
]

/** The app's easing for reveals (main.css uses it for expansion and hover). */
export const POD_DBT_MOTION_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'
export const POD_DBT_MOTION_MS = 220
/** Horizontal distance from a trigger's edge to its text (px-2). */
const TEXT_INSET = 8

export type PodDbtTabIndicator = { left: number; width: number }

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

/**
 * Pod: the dock's tab motion. One underline slides to the active tab, so it reads as
 * the same element moving rather than a new one appearing, and the body flies in from
 * the side the chosen tab is on. Both stand still when the user asked for reduced motion.
 */
export function usePodDbtDockMotion(view: PodDbtDockView | undefined): {
  setTrigger: (value: PodDbtDockView, element: HTMLButtonElement | null) => void
  bodyRef: React.MutableRefObject<HTMLDivElement | null>
  indicator: PodDbtTabIndicator | null
} {
  const triggers = useRef(new Map<PodDbtDockView, HTMLButtonElement>())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const previous = useRef(view)
  const [indicator, setIndicator] = useState<PodDbtTabIndicator | null>(null)

  const setTrigger = useCallback((value: PodDbtDockView, element: HTMLButtonElement | null) => {
    if (element) {
      triggers.current.set(value, element)
    } else {
      triggers.current.delete(value)
    }
  }, [])

  const measure = useCallback(() => {
    const element = view ? triggers.current.get(view) : undefined
    if (!element) {
      setIndicator(null)
      return
    }
    setIndicator({
      left: element.offsetLeft + TEXT_INSET,
      width: Math.max(0, element.offsetWidth - TEXT_INSET * 2)
    })
  }, [view])

  useLayoutEffect(() => {
    measure()
    const element = view ? triggers.current.get(view) : undefined
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    // Why observe: a font or language change moves the text under the underline.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure, view])

  useEffect(() => {
    const from = previous.current
    previous.current = view
    const body = bodyRef.current
    if (!view || !from || from === view || !body || typeof body.animate !== 'function') {
      return
    }
    if (prefersReducedMotion()) {
      return
    }
    const direction = POD_DBT_DOCK_VIEWS.indexOf(view) > POD_DBT_DOCK_VIEWS.indexOf(from) ? 1 : -1
    body.animate(
      [
        { opacity: 0, transform: `translateX(${direction * 12}px)` },
        { opacity: 1, transform: 'translateX(0)' }
      ],
      { duration: POD_DBT_MOTION_MS, easing: POD_DBT_MOTION_EASING }
    )
  }, [view])

  return { setTrigger, bodyRef, indicator }
}
