import { describe, it, expect, vi } from 'vitest'
import { createClearStatus } from '../../../src/utils/clearStatus.js'

describe('utils/clearStatus', () => {
  it('creates a function that resets saving state to default values', () => {
    const mockSetSavingState = vi.fn()
    const clearStatus = createClearStatus(mockSetSavingState)

    clearStatus()

    expect(mockSetSavingState).toHaveBeenCalledWith({ action: null, disabled: false })
  })

  it('clearStatus function can be called multiple times', () => {
    const mockSetSavingState = vi.fn()
    const clearStatus = createClearStatus(mockSetSavingState)

    clearStatus()
    clearStatus()
    clearStatus()

    expect(mockSetSavingState).toHaveBeenCalledTimes(3)
    expect(mockSetSavingState).toHaveBeenCalledWith({ action: null, disabled: false })
  })
})