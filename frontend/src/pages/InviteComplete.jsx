import React, { useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TextInput from '../components/form/fields/TextInput'
import Checkbox from '../components/form/fields/Checkbox'
import { useForm, required } from '../components/form/useForm'
import ErrorNotice from '../components/feedback/ErrorNotice'
import Loader from '../components/feedback/Loader'
import { useAuth } from '../context/AuthContext'

export default function InviteComplete() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()
  const { deviceId } = useAuth()

  const [nonce, setNonce] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [startTime] = useState(Date.now())
  const [totpSecret] = useState(() => {
    // Basic 32-char secret generation (Base32 style alphabet)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let secret = ''
    for (let i = 0; i < 32; i++) {
      secret += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
    }
    return secret
  })

  const form = useForm({
    password: '',
    totp_code: '',
    trust_device: false,
    email: '', // honeypot
  })

  useEffect(() => {
    apiClient
      .get('/auth/invite/page')
      .then((data) => setNonce(data.nonce))
      .catch((err) => setError('Failed to initialize invite page: ' + err.message))
  }, [])

  const onSubmit = async (values) => {
    // 5-second minimum time check (frontend side protection)
    const elapsed = (Date.now() - startTime) / 1000
    if (elapsed < 5) {
      setError('Please take a moment to review the setup (anti-bot protection).')
      return
    }

    if (!token) {
      setError('Invite token is missing from URL.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const payload = {
        token,
        password: values.password,
        device_id: deviceId,
        page_nonce: nonce,
        totp_code: values.totp_code,
        totp_secret: totpSecret,
        trust_device: values.trust_device,
        email: values.email || '', // Must be empty (honeypot)
      }

      await apiClient.post('/auth/invite/complete', payload)
      navigate('/login?message=Setup complete. Please log in.')
    } catch (err) {
      setError(err.detail || err.message || 'Invitation completion failed')
    } finally {
      setLoading(false)
    }
  }

  if (!nonce && !error)
    return (
      <div style={containerStyle}>
        <Loader label="Initializing..." />
      </div>
    )

  return (
    <div className="layout" style={containerStyle}>
      <div className="card" style={cardStyle}>
        <h1 className="mt-0">Complete Setup</h1>
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Set your password and configure Two-Factor Authentication.
        </p>

        {error && <ErrorNotice message={error} />}

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <TextInput
            form={form}
            name="password"
            label="Create Password"
            type="password"
            placeholder="Min 8 characters"
            validators={[required()]}
          />

          <div style={{ height: 24 }} />

          <div style={mfaBoxStyle}>
            <h3 className="mt-0">Two-Factor Authentication</h3>
            <p style={{ fontSize: 14 }} className="text-muted">
              Scan this secret in your authenticator app (e.g. Google Authenticator, Authy):
            </p>
            <div style={secretStyle}>{totpSecret}</div>
            <div style={{ height: 16 }} />
            <TextInput
              form={form}
              name="totp_code"
              label="Verification Code"
              placeholder="6-digit code"
              validators={[required()]}
            />
          </div>

          <div style={{ height: 16 }} />

          {/* Honeypot field - visually hidden */}
          <div style={{ display: 'none' }}>
            <TextInput form={form} name="email" label="Email" />
          </div>

          <Checkbox form={form} name="trust_device" label="Trust this device" />

          <div style={{ height: 24 }} />

          <button type="submit" disabled={loading} className="btn btn-primary" style={buttonStyle}>
            {loading ? 'Processing...' : 'Complete Setup'}
          </button>
        </form>
      </div>
    </div>
  )
}

const containerStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '100vh',
  background: 'var(--sidebar-bg)',
  padding: 16,
  boxSizing: 'border-box',
}

const cardStyle = {
  width: '100%',
  maxWidth: 460,
  padding: 32,
  borderRadius: 12,
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  boxSizing: 'border-box',
}

const mfaBoxStyle = {
  padding: 16,
  background: 'var(--sidebar-bg)',
  borderRadius: 8,
  border: '1px solid var(--border)',
}

const secretStyle = {
  fontFamily: 'monospace',
  fontSize: 18,
  letterSpacing: 2,
  padding: 12,
  background: 'var(--bg)',
  border: '1px dashed var(--muted)',
  borderRadius: 4,
  textAlign: 'center',
  wordBreak: 'break-all',
  color: 'var(--text)',
}

const buttonStyle = {
  width: '100%',
  fontWeight: 600,
  fontSize: 16,
}
