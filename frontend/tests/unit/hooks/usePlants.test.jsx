import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import usePlants from '../../../src/hooks/usePlants.js'
import { plantsApi } from '../../../src/api/plants.js'

vi.mock('../../../src/api/plants.js', () => ({
  plantsApi: {
    list: vi.fn(),
  },
}))

describe('usePlants hook', () => {
  test('refetch calls list again', async () => {
    plantsApi.list.mockResolvedValue({ items: [{ uuid: '1', name: 'A' }], total: 1 })

    const { result } = renderHook(() => usePlants({ page: 1, limit: 10 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(plantsApi.list).toHaveBeenCalledTimes(1)

    // Call refetch
    act(() => {
      result.current.refetch()
    })

    await waitFor(() => expect(plantsApi.list).toHaveBeenCalledTimes(2))
  })
})
