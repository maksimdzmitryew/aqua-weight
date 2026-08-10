/** WhatsApp helpers localStorage utility */

const STORAGE_KEY = 'whatsapp_helpers'

export function getHelpers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addHelper(helper) {
  const helpers = getHelpers()
  const id =
    crypto.randomUUID?.() || Math.random().toString(36).substring(2) + Date.now().toString(36)
  const newHelper = { ...helper, id }
  helpers.push(newHelper)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(helpers))
  return newHelper
}

export function updateHelper(id, data) {
  const helpers = getHelpers()
  const idx = helpers.findIndex((h) => h.id === id)
  if (idx !== -1) {
    helpers[idx] = { ...helpers[idx], ...data }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(helpers))
  }
  return helpers[idx]
}

export function removeHelper(id) {
  const helpers = getHelpers().filter((h) => h.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(helpers))
  return helpers
}

export function getOwnerUserId() {
  try {
    return localStorage.getItem('userId') || null
  } catch {
    return null
  }
}
