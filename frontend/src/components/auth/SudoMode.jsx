import React, { useState } from 'react'
import { useTheme } from '../../ThemeContext.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'

/**
 * SudoMode component provides a password re-verification barrier for sensitive actions.
 * It follows the "Sudo Mode" pattern common in security-conscious applications.
 *
 * @param {boolean} open - Whether the modal is open.
 * @param {function} onConfirm - Callback called with the password upon confirmation.
 * @param {function} onCancel - Callback called when the action is cancelled.
 * @param {string} title - Optional title for the modal.
 * @param {string} message - Optional message for the modal.
 */
export default function SudoMode({
  open,
  onConfirm,
  onCancel,
  title = 'Security Verification',
  message = 'Please enter your password to proceed with this sensitive action.',
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'

  const handleConfirm = () => {
    if (!password) {
      setError('Password is required')
      return
    }
    onConfirm(password)
    setPassword('')
    setError('')
  }

  const handleCancel = () => {
    setPassword('')
    setError('')
    onCancel()
  }

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
    borderRadius: 6,
    background: isDark ? '#111827' : '#ffffff',
    color: isDark ? '#f9fafb' : '#111827',
    marginTop: 12,
    boxSizing: 'border-box',
  }

  const buttons = [
    {
      key: 'cancel',
      text: 'Cancel',
      onClick: handleCancel,
      style: {
        padding: '8px 12px',
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        color: isDark ? '#9ca3af' : '#4b5563',
      },
    },
    {
      key: 'confirm',
      text: 'Verify Password',
      onClick: handleConfirm,
      style: {
        padding: '8px 16px',
        cursor: 'pointer',
        background: isDark ? '#3b82f6' : '#2563eb',
        color: 'white',
        border: 'none',
        borderRadius: 6,
      },
    },
  ]

  const messageContent = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleConfirm()
      }}
    >
      <div>{message}</div>
      <input
        type="password"
        placeholder="Enter your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={inputStyle}
        autoFocus
      />
      {error && (
        <div style={{ color: '#ef4444', fontSize: '0.85em', marginTop: 6, textAlign: 'left' }}>
          {error}
        </div>
      )}
      <button type="submit" style={{ display: 'none' }} />
    </form>
  )

  return (
    <ConfirmDialog
      open={open}
      title={title}
      message={messageContent}
      onCancel={handleCancel}
      buttons={buttons}
      icon="question"
    />
  )
}
