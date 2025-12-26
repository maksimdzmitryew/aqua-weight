import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import BulkMeasurementTable from '../../../src/components/BulkMeasurementTable.jsx'

function makePlant(overrides = {}) {
  return {
    uuid: 'p-1',
    id: undefined,
    name: 'Ficus',
    identify_hint: 'ID',
    notes: 'Some notes',
    location: 'Living room',
    current_weight: '',
    water_retained_pct: 30,
    recommended_water_threshold_pct: 40,
    water_loss_total_pct: 25,
    latest_at: '2025-01-02T03:04:05Z',
    measured_at: undefined,
    ...overrides,
  }
}

describe('BulkMeasurementTable', () => {
  test('renders rows and needs-water badge when retained ≤ threshold; link click calls onViewPlant', () => {
    const p1 = makePlant({ water_retained_pct: 20, recommended_water_threshold_pct: 25 }) // needs water
    const onViewPlant = vi.fn()
    render(
      <BulkMeasurementTable
        plants={[p1]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
        onViewPlant={onViewPlant}
      />
    )

    // Name cell renders as a link (uuid present)
    const link = screen.getByRole('link', { name: /ID Ficus/i })
    expect(link).toBeInTheDocument()

    // Needs water badge present with role status
    expect(screen.getByRole('status')).toHaveTextContent(/Needs water/i)

    // Clicking name link triggers onViewPlant with the plant object
    fireEvent.click(link)
    expect(onViewPlant).toHaveBeenCalledTimes(1)
    expect(onViewPlant).toHaveBeenCalledWith(expect.objectContaining({ uuid: p1.uuid }))

    // The Name cell should have background gradient style from getWaterRetainCellStyle
    const nameCell = link.closest('td')
    expect(nameCell).toBeTruthy()
    // Non-brittle check — style contains linear-gradient
    expect(nameCell.getAttribute('style') || '').toMatch(/linear-gradient/i)
  })

  test('does not render badge when retained > threshold; renders plain text when no uuid', () => {
    const p = makePlant({ uuid: undefined, name: 'Cactus', identify_hint: '', water_retained_pct: 90, recommended_water_threshold_pct: 40 })
    render(
      <BulkMeasurementTable
        plants={[p]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
      />
    )

    // No link since uuid missing
    expect(screen.queryByRole('link', { name: /Cactus/ })).not.toBeInTheDocument()
    // Name appears as plain text
    expect(screen.getByText('Cactus')).toBeInTheDocument()
    // No badge
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('non-uuid row: titles absent on name/notes/water-loss cells; water loss text has no %', () => {
    const p = makePlant({ uuid: undefined, identify_hint: '', name: 'Plain', notes: 'NN', water_loss_total_pct: 42 })
    render(
      <BulkMeasurementTable plants={[p]} inputStatus={{}} onCommitValue={vi.fn()} />
    )
    const nameCell = screen.getByText('Plain').closest('td')
    expect(nameCell).toBeTruthy()
    expect(nameCell).not.toHaveAttribute('title')
    const notesCell = screen.getByText('NN').closest('td')
    expect(notesCell).toBeTruthy()
    expect(notesCell).not.toHaveAttribute('title')
    const wlCell = screen.getByText('42').closest('td')
    expect(wlCell).toBeTruthy()
    expect(wlCell).not.toHaveAttribute('title')
  })

  test('showUpdatedColumn renders DateTimeText cell and uses title with raw value', () => {
    const latest = '2025-01-02T03:04:05Z'
    const p = makePlant({ latest_at: latest })
    render(
      <BulkMeasurementTable
        plants={[p]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
        showUpdatedColumn
      />
    )
    // Find cell by title attribute matching raw value (avoid locale formatting)
    const updatedCell = screen.getByTitle(latest)
    expect(updatedCell).toBeInTheDocument()
  })

  test('Updated column uses measured_at when latest_at is missing', () => {
    const measured = '2025-02-03T04:05:06Z'
    const p = makePlant({ latest_at: undefined, measured_at: measured })
    render(
      <BulkMeasurementTable
        plants={[p]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
        showUpdatedColumn
      />
    )
    const cell = screen.getByTitle(measured)
    expect(cell).toBeInTheDocument()
  })

  test('inputStatus toggles success/error classes; onCommitValue fires on blur only with value and uuid', () => {
    const pSuccess = makePlant({ uuid: 'u-ok', name: 'Ok Plant' })
    const pError = makePlant({ uuid: 'u-err', name: 'Err Plant' })
    const pNoUuid = makePlant({ uuid: undefined, name: 'NoUuid' })
    const onCommitValue = vi.fn()

    render(
      <BulkMeasurementTable
        plants={[pSuccess, pError, pNoUuid]}
        inputStatus={{ 'u-ok': 'success', 'u-err': 'error' }}
        onCommitValue={onCommitValue}
      />
    )

    // Inputs are rendered in row order
    const inputs = screen.getAllByRole('spinbutton')
    // Success plant input has bg-success
    expect(inputs[0].className).toMatch(/bg-success/)
    // Error plant input has bg-error
    expect(inputs[1].className).toMatch(/bg-error/)

    // Change value and blur for success plant — should call onCommitValue
    fireEvent.change(inputs[0], { target: { value: '123' } })
    fireEvent.blur(inputs[0])
    expect(onCommitValue).toHaveBeenCalledWith('u-ok', '123')

    // Empty value should not call; set empty then blur
    onCommitValue.mockClear()
    fireEvent.change(inputs[1], { target: { value: '' } })
    fireEvent.blur(inputs[1])
    expect(onCommitValue).not.toHaveBeenCalled()

    // No uuid should not call even with value
    fireEvent.change(inputs[2], { target: { value: '999' } })
    fireEvent.blur(inputs[2])
    expect(onCommitValue).not.toHaveBeenCalled()
  })

  test('deemphasizePredicate applies row opacity', () => {
    const p = makePlant({ uuid: 'dim', name: 'Dim Plant' })
    const deemphasizePredicate = (plant) => plant.uuid === 'dim'
    render(
      <BulkMeasurementTable
        plants={[p]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
        deemphasizePredicate={deemphasizePredicate}
      />
    )
    const link = screen.getByRole('link', { name: /Dim Plant/i })
    const row = link.closest('tr')
    expect(row).toBeTruthy()
    expect(row.style.opacity).toBe('0.55')
  })

  test('waterLossCellStyle override is applied; default path also styles cell', () => {
    const pOverride = makePlant({ uuid: 'ov', name: 'Override', water_loss_total_pct: 10 })
    const override = () => ({ background: 'rgb(1, 2, 3)' })

    // First render with override
    const { rerender } = render(
      <BulkMeasurementTable
        plants={[pOverride]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
        waterLossCellStyle={override}
      />
    )

    // Override: find water loss cell by text and assert sentinel background
    const ovCell = screen.getByText('10%').closest('td')
    expect(ovCell).toBeTruthy()
    expect(ovCell).toHaveStyle({ background: 'rgb(1, 2, 3)' })

    // Then render default path without override
    const pDefault = makePlant({ uuid: 'df', name: 'Default', water_loss_total_pct: 150 }) // triggers default red background
    rerender(
      <BulkMeasurementTable
        plants={[pDefault]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
      />
    )
    const dfCell = screen.getByText('150%').closest('td')
    expect(dfCell).toBeTruthy()
    expect(dfCell).toHaveStyle({ background: '#dc2626' })
  })

  test('notes and water loss cells render links and invoke onViewPlant when uuid present', () => {
    const p = makePlant({ uuid: 'u1', notes: 'N', water_loss_total_pct: 7 })
    const onViewPlant = vi.fn()
    render(
      <BulkMeasurementTable
        plants={[p]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
        onViewPlant={onViewPlant}
      />
    )
    // Notes link
    const notesLink = screen.getByRole('link', { name: 'N' })
    fireEvent.click(notesLink)
    // Water loss link (text includes %)
    const wlLink = screen.getByRole('link', { name: '7%' })
    fireEvent.click(wlLink)
    expect(onViewPlant).toHaveBeenCalledTimes(2)
    expect(onViewPlant).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'u1' }))
  })

  test('link text omits identify_hint when absent, and notes link shows fallback when empty', () => {
    const p = makePlant({ uuid: 'u2', identify_hint: '', name: 'OnlyName', notes: '' })
    render(
      <BulkMeasurementTable plants={[p]} inputStatus={{}} onCommitValue={vi.fn()} />
    )
    // Name link should show only the name without extra space
    expect(screen.getByRole('link', { name: 'OnlyName' })).toBeInTheDocument()
    // Notes link shows fallback dash when empty
    expect(screen.getByRole('link', { name: '—' })).toBeInTheDocument()
  })

  test('non-uuid name cell shows identify_hint + name text', () => {
    const p = makePlant({ uuid: undefined, identify_hint: 'Hint', name: 'Name' })
    render(
      <BulkMeasurementTable plants={[p]} inputStatus={{}} onCommitValue={vi.fn()} />
    )
    expect(screen.getByText('Hint Name')).toBeInTheDocument()
  })

  test('non-uuid name falls back to empty string when name missing; notes falls back to dash', () => {
    const p = makePlant({ uuid: undefined, identify_hint: '', name: undefined, notes: '' })
    render(
      <BulkMeasurementTable plants={[p]} inputStatus={{}} onCommitValue={vi.fn()} />
    )
    // Name cell should exist but have empty text content
    const nameCell = screen.getAllByRole('cell').find(td => td.textContent === '')
    expect(nameCell).toBeTruthy()
    // Notes cell shows dash in non-uuid path
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  test('first column tooltip and label render, and cell titles depend on uuid', () => {
    const pWith = makePlant({ uuid: 'has', notes: 'Note', water_loss_total_pct: 3 })
    const pWithout = makePlant({ uuid: undefined, identify_hint: '', name: 'Plain', notes: '', water_loss_total_pct: 0 })
    const { container } = render(
      <BulkMeasurementTable
        plants={[pWith, pWithout]}
        inputStatus={{}}
        onCommitValue={vi.fn()}
        firstColumnLabel="Value"
        firstColumnTooltip="Enter latest value"
      />
    )
    // Header first column has the provided title attribute
    const firstHeader = screen.getByRole('columnheader', { name: /Value/i })
    expect(firstHeader).toHaveAttribute('title', 'Enter latest value')

    // For uuid-present row, certain cells have title="View plant"
    const links = screen.getAllByRole('link')
    links.forEach((a) => {
      const td = a.closest('td')
      if (td) expect(td).toHaveAttribute('title', 'View plant')
    })

    // For uuid-absent row, the name cell is plain text and has no title attr
    const nameCellPlain = screen.getByText('Plain').closest('td')
    expect(nameCellPlain).toBeTruthy()
    expect(nameCellPlain).not.toHaveAttribute('title')

    // Exercise onChange handler (no-op) to cover its function
    const input = screen.getAllByRole('spinbutton')[0]
    // change twice to exercise code path
    input.value = '5'
    fireEvent.change(input, { target: { value: '5' } })
    input.value = '6'
    fireEvent.change(input, { target: { value: '6' } })
  })

  test('renders empty state with correct colSpan when no plants', () => {
    const { rerender } = render(
      <BulkMeasurementTable plants={[]} inputStatus={{}} onCommitValue={vi.fn()} />
    )
    const cell = screen.getByText(/No plants found/i)
    expect(cell).toBeInTheDocument()
    expect(cell).toHaveAttribute('colspan', '6')

    // With Updated column enabled, colspan increases to 7
    rerender(
      <BulkMeasurementTable plants={[]} inputStatus={{}} onCommitValue={vi.fn()} showUpdatedColumn />
    )
    const cell2 = screen.getByText(/No plants found/i)
    expect(cell2).toHaveAttribute('colspan', '7')
  })

  test('location cell shows provided location and falls back to dash when missing', () => {
    // Truthy path
    const pWith = makePlant({ location: 'Living room' })
    const { rerender } = render(
      <BulkMeasurementTable plants={[pWith]} inputStatus={{}} onCommitValue={vi.fn()} />
    )
    let locCell = document.querySelector('td.hide-column-phone')
    expect(locCell).toBeTruthy()
    expect(locCell?.textContent).toBe('Living room')

    // Falsy path (fallback)
    const pWithout = makePlant({ location: undefined })
    rerender(
      <BulkMeasurementTable plants={[pWithout]} inputStatus={{}} onCommitValue={vi.fn()} />
    )
    locCell = document.querySelector('td.hide-column-phone')
    expect(locCell).toBeTruthy()
    expect(locCell?.textContent).toBe('—')
  })
})
