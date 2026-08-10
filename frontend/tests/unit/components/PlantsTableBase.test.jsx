import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PlantsTableBase, { TableHeader } from '../../../src/components/PlantsTableBase'

describe('PlantsTableBase', () => {
  const mockPlants = [
    { id: 1, name: 'P1' },
    { id: 2, name: 'P2' },
  ]
  const renderHeaders = () => <th>Name</th>
  const renderRow = (p) => <td>{p.name}</td>

  it('renders empty message when no plants', () => {
    render(
      <PlantsTableBase
        plants={[]}
        renderHeaders={renderHeaders}
        renderRow={renderRow}
        emptyMessage="Nothing here"
      />,
    )
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('renders rows for plants', () => {
    render(
      <PlantsTableBase plants={mockPlants} renderHeaders={renderHeaders} renderRow={renderRow} />,
    )
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('P2')).toBeInTheDocument()
  })

  it('applies rowProps correctly', () => {
    const rowProps = (p) => ({ 'data-testid': `row-${p.id}`, className: 'custom-row' })
    render(
      <PlantsTableBase
        plants={mockPlants}
        renderHeaders={renderHeaders}
        renderRow={renderRow}
        rowProps={rowProps}
      />,
    )
    expect(screen.getByTestId('row-1')).toHaveClass('custom-row')
  })
})

describe('TableHeader', () => {
  const renderInTable = (ui) =>
    render(
      <table>
        <thead>
          <tr>{ui}</tr>
        </thead>
      </table>,
    )

  it('renders title as tooltip on click', () => {
    renderInTable(<TableHeader title="Info">Label</TableHeader>)

    expect(screen.getByText('Label')).toBeInTheDocument()

    const infoBtn = screen.getByRole('button')
    fireEvent.click(infoBtn)

    expect(screen.getByRole('tooltip')).toHaveTextContent('Info')
    expect(infoBtn).toHaveAttribute('aria-expanded', 'true')

    // Click again to close
    fireEvent.click(infoBtn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('handles keyboard interaction (Enter and Space)', () => {
    renderInTable(<TableHeader title="Info">Label</TableHeader>)
    const infoBtn = screen.getByRole('button')

    fireEvent.keyDown(infoBtn, { key: 'Enter' })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.keyDown(infoBtn, { key: ' ' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('closes on outside click', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <table>
          <thead>
            <tr>
              <TableHeader title="Info">Label</TableHeader>
            </tr>
          </thead>
        </table>
      </div>,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
