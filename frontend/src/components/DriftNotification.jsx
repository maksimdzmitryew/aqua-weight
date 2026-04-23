import React from 'react'
import '../styles/drift-notification.css'

export default function DriftNotification({ onRefresh, onDismiss }) {
  return (
    <div className="drift-notification" role="alert" aria-live="polite">
      <div className="drift-notification-content">
        <span className="drift-notification-icon">ℹ️</span>
        <span className="drift-notification-message">
          Plants list updated. Page might have shifted.
        </span>
      </div>
      <div className="drift-notification-actions">
        <button
          className="drift-notification-btn drift-notification-btn-refresh"
          onClick={onRefresh}
          aria-label="Refresh page"
        >
          Refresh
        </button>
        <button
          className="drift-notification-btn drift-notification-btn-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
