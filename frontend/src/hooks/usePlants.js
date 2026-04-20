import { useEffect, useState } from 'react'
import { plantsApi } from '../api/plants'

/**
 * usePlants hook - Shared data fetching logic for plants
 *
 * Fetches full plant data with pagination support.
 * Extracts items from paginated API response.
 *
 * @param {Object} options - Fetch options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 100, max allowed by backend)
 * @param {string} options.search - Search query
 * @returns {Object} { plants, loading, error, refetch, total, totalPages }
 */
export default function usePlants({ page = 1, limit = 100, search = '' } = {}) {
  const [plants, setPlants] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function fetchPlants(signal) {
    try {
      setLoading(true)
      setError('')

      const response = await plantsApi.list({ page, limit, search, signal })

      setPlants(response.items || [])
      setTotal(response.total || 0)
      setTotalPages(response.total_pages || 0)
      setLoading(false)
    } catch (e) {
      const msg = e?.message || ''
      const isAbort = e?.name === 'AbortError' || msg.toLowerCase().includes('abort')
      if (isAbort) return
      setError(msg || 'Failed to load plants')
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchPlants(controller.signal)
    return () => controller.abort()
  }, [page, limit, search])

  const refetch = () => {
    const controller = new AbortController()
    fetchPlants(controller.signal)
  }

  return { plants, loading, error, refetch, total, totalPages }
}
