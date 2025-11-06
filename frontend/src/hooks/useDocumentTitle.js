import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * useDocumentTitle
 * Small hook to standardize document.title handling across pages.
 *
 * Usage:
 *   useDocumentTitle('Plants')            // => "Plants – AW Frontend"
 *   useDocumentTitle(plant?.name || 'Plant details')
 *
 * Options:
 *   - restoreOnUnmount: boolean (default: false)
 *       If true, restores the previous title on unmount.
 */
export default function useDocumentTitle(title, options = {}) {
  const { restoreOnUnmount = false } = options
  const prevTitleRef = useRef(typeof document !== 'undefined' ? document.title : '')
  const location = useLocation()

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return

    const base = 'AW Frontend'
    const safeTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : ''
    const next = safeTitle ? `${safeTitle} – ${base}` : base

    if (document.title !== next) {
      document.title = next
      // Optional microtask re-assert in case late writers fire post-paint
      queueMicrotask?.(() => {
        if (document.title !== next) document.title = next
      })
    }

    return () => {
      if (restoreOnUnmount) {
        document.title = prevTitleRef.current
      }
    }
  // Re-assert on route changes even if `title` string stays the same
  }, [title, location.key, restoreOnUnmount])
}