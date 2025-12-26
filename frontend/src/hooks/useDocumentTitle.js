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
  // Allow dependency injection of a document-like object for testability.
  // If the `doc` key is present in options, use it verbatim (even if undefined),
  // otherwise fall back to the global document when available.
  const hasInjectedDoc = Object.prototype.hasOwnProperty.call(options, 'doc')
  // Use injected doc when provided; otherwise rely on globalThis.document which is
  // undefined in SSR without throwing (avoids an extra conditional branch for coverage).
  const doc = hasInjectedDoc ? options.doc : globalThis.document
  const prevTitleRef = useRef(doc ? doc.title : '')
  const location = useLocation()

  useLayoutEffect(() => {
    if (!doc) return

    const base = 'AW Frontend'
    const safeTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : ''
    const next = safeTitle ? `${safeTitle} – ${base}` : base

    if (doc.title !== next) {
      doc.title = next
      // Optional microtask re-assert in case late writers fire post-paint
      queueMicrotask?.(() => {
        if (doc.title !== next) doc.title = next
      })
    }

    return () => {
      if (restoreOnUnmount && doc) {
        doc.title = prevTitleRef.current
      }
    }
  // Re-assert on route changes even if `title` string stays the same
  }, [title, location.key, restoreOnUnmount])
}