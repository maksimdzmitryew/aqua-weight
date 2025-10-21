import React, { useEffect, useRef } from 'react'
import { useTheme } from '../ThemeContext.jsx'

export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message = '',
  confirmText = 'Delete',
  cancelText = 'Cancel',
  tone = 'danger', // 'danger' | 'default' | 'warning' | 'info' | 'success'
  onConfirm,
  onCancel,
  // optional buttons override for future: [{ key, text, tone, onClick }]
  buttons,
  // optional explicit icon override: 'warning' | 'info' | 'success' | 'question' | 'danger'
  icon,
}) {
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'
  const overlayRef = useRef(null)
  const firstBtnRef = useRef(null)

  useEffect(() => {
    function onKey(e) {
      if (!open) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel && onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  useEffect(() => {
    if (open && firstBtnRef.current) {
      try { firstBtnRef.current.focus() } catch {}
    }
  }, [open])

  if (!open) return null

  const colors = {
    overlay: 'rgba(0,0,0,0.4)',
    panelBg: isDark ? '#0d1628' : '#ffffff',
    panelBorder: isDark ? '#1f2937' : '#e5e7eb',
    title: isDark ? '#e5e7eb' : '#111827',
    text: isDark ? '#cbd5e1' : '#374151',
    btnBg: isDark ? '#111827' : '#f3f4f6',
    btnBorder: isDark ? '#374151' : '#d1d5db',
    dangerBg: isDark ? '#2b0f14' : '#fef2f2',
    dangerBorder: isDark ? '#7f1d1d' : '#fecaca',
    dangerText: isDark ? '#fecaca' : '#991b1b',
    primaryBg: isDark ? '#1f2937' : '#111827',
    primaryText: '#ffffff',
    // Additional tone colors
    infoBg: isDark ? '#0b2540' : '#eff6ff',
    infoBorder: isDark ? '#1d4ed8' : '#bfdbfe',
    infoText: isDark ? '#93c5fd' : '#1d4ed8',
    successBg: isDark ? '#0f2d20' : '#ecfdf5',
    successBorder: isDark ? '#065f46' : '#a7f3d0',
    successText: isDark ? '#6ee7b7' : '#065f46',
    warningBg: isDark ? '#331f04' : '#fffbeb',
    warningBorder: isDark ? '#92400e' : '#fde68a',
    warningText: isDark ? '#fcd34d' : '#92400e',
  }

  const toneKind = (tone || 'default').toLowerCase()
  const toneStyles = {
    danger: { bg: colors.dangerBg, border: colors.dangerBorder, text: colors.dangerText },
    info: { bg: colors.infoBg, border: colors.infoBorder, text: colors.infoText },
    success: { bg: colors.successBg, border: colors.successBorder, text: colors.successText },
    warning: { bg: colors.warningBg, border: colors.warningBorder, text: colors.warningText },
    default: { bg: colors.infoBg, border: colors.infoBorder, text: colors.infoText },
  }

  const ICONS = {
    // Warning / danger
    danger: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
    warning: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
    // Info
    info: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
    ),
    // Success
    success: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
    // Question
    question: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 1 1 5.82 1c0 2-3 2-3 4"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  }

  const headerTone = toneStyles[toneKind] || toneStyles.default
  const resolvedIconKey = icon || (toneKind === 'danger' ? 'danger' : (toneKind === 'warning' ? 'warning' : (toneKind === 'success' ? 'success' : (toneKind === 'info' ? 'info' : 'info'))))
  const iconEl = ICONS[resolvedIconKey] || ICONS['warning']

  const headerIcon = (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: headerTone.bg,
          border: `1px solid ${headerTone.border}`,
          color: headerTone.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {iconEl}
      </div>
    </div>
  )

  const btnBase = {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid transparent',
    cursor: 'pointer',
    background: colors.btnBg,
    borderColor: colors.btnBorder,
    color: isDark ? '#e5e7eb' : '#111827',
  }

  const btnDanger = {
    background: colors.dangerBg,
    borderColor: colors.dangerBorder,
    color: colors.dangerText,
  }

  const btnPrimary = {
    background: colors.primaryBg,
    borderColor: colors.primaryBg,
    color: colors.primaryText,
  }

  const defaultButtons = [
    // Cancel is first to allow quick safe action
    { key: 'cancel', text: cancelText, style: btnBase, onClick: onCancel, ref: firstBtnRef },
    // Confirm uses danger or primary styles depending on tone
    { key: 'confirm', text: confirmText, style: tone === 'danger' ? { ...btnBase, ...btnDanger } : { ...btnBase, ...btnPrimary }, onClick: onConfirm },
  ]

  const shownButtons = Array.isArray(buttons) && buttons.length > 0 ? buttons : defaultButtons

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel && onCancel()
      }}
      ref={overlayRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: colors.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: colors.panelBg,
          color: colors.text,
          border: `1px solid ${colors.panelBorder}`,
          borderRadius: 10,
          boxShadow: isDark ? '0 10px 30px rgba(0,0,0,0.5)' : '0 10px 30px rgba(0,0,0,0.15)',
          padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {headerIcon}
        <div id="confirm-title" style={{ fontSize: 18, fontWeight: 700, color: colors.title, marginBottom: 8, textAlign: 'center' }}>{title}</div>
        {message && (
          <div id="confirm-desc" style={{ marginBottom: 16, lineHeight: 1.4, textAlign: 'center' }}>{message}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {shownButtons.map((b) => (
            <button
              key={b.key}
              type="button"
              ref={b.ref}
              onClick={b.onClick}
              style={b.style}
            >
              {b.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
