import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchField from '../../../src/components/SearchField.jsx'

describe('SearchField', () => {
  test('renders with defaults and associates a11y attributes', () => {
    const handleChange = vi.fn()
    render(<SearchField value="" onChange={handleChange} />)

    const input = screen.getByRole('searchbox', { name: 'Search' })
    expect(input).toBeInTheDocument()
    // Default placeholder
    expect(input).toHaveAttribute('placeholder', 'Search…')

    // Clear button exists but is disabled when value is empty
    const clearBtn = screen.getByRole('button', { name: 'Clear search' })
    expect(clearBtn).toBeDisabled()
  })

  test('typing calls onChange with the typed value', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<SearchField value="" onChange={handleChange} placeholder="Find" />)

    const input = screen.getByPlaceholderText('Find')
    await user.type(input, 'a')
    // onChange is called with the current value for controlled input (single char here)
    expect(handleChange).toHaveBeenCalledWith('a')
  })

  test('clear button enabled when value present; clicking clears via onChange("")', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    // render with a non-empty value to enable the clear button
    render(<SearchField value="fern" onChange={handleChange} ariaLabel="Filter" />)

    const input = screen.getByRole('searchbox', { name: 'Filter' })
    expect(input).toHaveValue('fern')

    const clearBtn = screen.getByRole('button', { name: 'Clear search' })
    expect(clearBtn).toBeEnabled()

    await user.click(clearBtn)
    expect(handleChange).toHaveBeenCalledWith('')
  })
})
