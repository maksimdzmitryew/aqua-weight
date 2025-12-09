import React from 'react'
import { describe, test, expect } from 'vitest'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useDocumentTitle from '../../../src/hooks/useDocumentTitle.js'

function UseTitle({ title, restore }) {
  useDocumentTitle(title, { restoreOnUnmount: restore })
  return <div>content</div>
}

function Page({ title }) {
  const nav = useNavigate()
  return (
    <div>
      <UseTitle title={title} />
      <button onClick={() => nav('/two')}>go</button>
    </div>
  )
}

describe('hooks/useDocumentTitle', () => {
  test('sets base title when falsy and custom title when provided', () => {
    // Ensure starting point
    document.title = 'Start'

    const { rerender } = render(
      <MemoryRouter initialEntries={[{ pathname: '/' }]}> 
        <Routes>
          <Route path="/" element={<UseTitle title="" />} />
        </Routes>
      </MemoryRouter>
    )

    expect(document.title).toBe('AW Frontend')

    rerender(
      <MemoryRouter initialEntries={[{ pathname: '/' }]}> 
        <Routes>
          <Route path="/" element={<UseTitle title="Plants" />} />
        </Routes>
      </MemoryRouter>
    )
    expect(document.title).toBe('Plants – AW Frontend')
  })

  test('re-applies same title on route change to counter late writers; reacts to location key changes', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[{ pathname: '/one' }]}> 
        <Routes>
          <Route path="/one" element={<Page title="Same" />} />
          <Route path="/two" element={<UseTitle title="Same" />} />
        </Routes>
      </MemoryRouter>
    )

    // Initially applied
    expect(document.title).toBe('Same – AW Frontend')

    // Simulate some other code messing with title
    document.title = 'Corrupted'
    expect(document.title).toBe('Corrupted')

    // Navigate to a different route with the same title prop
    await user.click(screen.getByRole('button', { name: /go/i }))

    // Effect should have re-applied the proper title after navigation
    expect(document.title).toBe('Same – AW Frontend')
  })

  test('restores previous title on unmount when restoreOnUnmount is true', () => {
    document.title = 'Original'

    const { unmount } = render(
      <MemoryRouter initialEntries={[{ pathname: '/' }]}> 
        <Routes>
          <Route path="/" element={<UseTitle title="Page" restore />} />
        </Routes>
      </MemoryRouter>
    )

    // While mounted
    expect(document.title).toBe('Page – AW Frontend')

    // Unmount should restore
    unmount()
    expect(document.title).toBe('Original')
  })

  test('does not rewrite when title already matches target (no-op branch)', () => {
    // Set current title to base
    document.title = 'AW Frontend'

    render(
      <MemoryRouter initialEntries={[{ pathname: '/' }]}> 
        <Routes>
          <Route path="/" element={<UseTitle title="" />} />
        </Routes>
      </MemoryRouter>
    )

    // Remains unchanged since it's already the desired value
    expect(document.title).toBe('AW Frontend')
  })

  test('supports server-like env: injected doc undefined initializes safely and early-returns', () => {
    function UseTitleInjected({ title, restore, doc }) {
      useDocumentTitle(title, { restoreOnUnmount: restore, doc })
      return <div>content</div>
    }

    document.title = 'Keep'

    const { rerender, unmount } = render(
      <MemoryRouter initialEntries={[{ pathname: '/' }]}>
        <Routes>
          <Route path="/" element={<UseTitleInjected title="Page" restore doc={undefined} />} />
        </Routes>
      </MemoryRouter>
    )

    // Since injected doc is undefined, hook should not touch the real document
    expect(document.title).toBe('Keep')

    // Rerender with a different title still should not change anything
    rerender(
      <MemoryRouter initialEntries={[{ pathname: '/' }]}>
        <Routes>
          <Route path="/" element={<UseTitleInjected title="Another" restore doc={undefined} />} />
        </Routes>
      </MemoryRouter>
    )
    expect(document.title).toBe('Keep')

    // Unmount path with restoreOnUnmount should be a no-op when doc is undefined
    unmount()
    expect(document.title).toBe('Keep')
  })
})
