import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import BulkMeasurementTable from '../../src/components/BulkMeasurementTable.jsx'

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
    const onViewPlant = jest.fn()
    render(
      <BulkMeasurementTable
        plants={[p1]}
        inputStatus={{}}
        onCommitValue={jest.fn()}
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
        onCommitValue={jest.fn()}
      />
    )

    // No link since uuid missing
    expect(screen.queryByRole('link', { name: /Cactus/ })).not.toBeInTheDocument()
    // Name appears as plain text
    expect(screen.getByText('Cactus')).toBeInTheDocument()
    // No badge
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('showUpdatedColumn renders DateTimeText cell and uses title with raw value', () => {
    const latest = '2025-01-02T03:04:05Z'
    const p = makePlant({ latest_at: latest })
    render(
      <BulkMeasurementTable
        plants={[p]}
        inputStatus={{}}
        onCommitValue={jest.fn()}
        showUpdatedColumn
      />
    )
    // Find cell by title attribute matching raw value (avoid locale formatting)
    const updatedCell = screen.getByTitle(latest)
    expect(updatedCell).toBeInTheDocument()
  })

  test('inputStatus toggles success/error classes; onCommitValue fires on blur only with value and uuid', () => {
    const pSuccess = makePlant({ uuid: 'u-ok', name: 'Ok Plant' })
    const pError = makePlant({ uuid: 'u-err', name: 'Err Plant' })
    const pNoUuid = makePlant({ uuid: undefined, name: 'NoUuid' })
    const onCommitValue = jest.fn()

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
        onCommitValue={jest.fn()}
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
    const pDefault = makePlant({ uuid: 'df', name: 'Default', water_loss_total_pct: 150 }) // triggers default red background
    const override = () => ({ background: 'rgb(1, 2, 3)' })

    render(
      <BulkMeasurementTable
        plants={[pOverride, pDefault]}
        inputStatus={{}}
        onCommitValue={jest.fn()}
        waterLossCellStyle={override}
      />
    )

    // Override: find water loss cell by text and assert sentinel background
    const ovCell = screen.getByText('10%').closest('td')
    expect(ovCell).toBeTruthy()
    expect(ovCell).toHaveStyle({ background: 'rgb(1, 2, 3)' })

    // Default: style should come from getWaterLossCellStyle (>100 => #dc2626)
    const dfCell = screen.getByText('150%').closest('td')
    expect(dfCell).toBeTruthy()
    expect(dfCell).toHaveStyle({ background: '#dc2626' })
  })

  test('renders empty state with correct colSpan when no plants', () => {
    const { rerender } = render(
      <BulkMeasurementTable plants={[]} inputStatus={{}} onCommitValue={jest.fn()} />
    )
    const cell = screen.getByText(/No plants found/i)
    expect(cell).toBeInTheDocument()
    expect(cell).toHaveAttribute('colspan', '6')

    // With Updated column enabled, colspan increases to 7
    rerender(
      <BulkMeasurementTable plants={[]} inputStatus={{}} onCommitValue={jest.fn()} showUpdatedColumn />
    )
    const cell2 = screen.getByText(/No plants found/i)
    expect(cell2).toHaveAttribute('colspan', '7')
  })
})
