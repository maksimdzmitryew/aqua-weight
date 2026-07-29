/**
 * Creates a clearStatus function that resets the saving state.
 * @param {Function} setSavingState - The setState function from useState
 * @returns {Function} A function that resets the saving state
 */
export function createClearStatus(setSavingState) {
  return function clearStatus() {
    setSavingState({ action: null, disabled: false })
  }
}