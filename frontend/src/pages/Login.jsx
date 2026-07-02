import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { toast } from 'react-hot-toast'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import useDocumentTitle from '../hooks/useDocumentTitle.js'
import TextInput from '../components/form/fields/TextInput.jsx'
import Checkbox from '../components/form/fields/Checkbox.jsx'
import { useForm, required } from '../components/form/useForm'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'

export default function Login() {
  const { login, verifyMfa, isAuthenticated, sessionExpired, setSessionExpired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mfaData, setMfaData] = useState(null)

  useDocumentTitle('Login')

  useEffect(() => {
    if (sessionExpired) {
      toast.error('Your session has expired. Please log in again.')
      setSessionExpired(false)
    }
  }, [sessionExpired, setSessionExpired])

  const from = location.state?.from?.pathname || '/dashboard'

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true })
    }
  }, [isAuthenticated, navigate, from])

  const loginForm = useForm({
    username: '',
    password: '',
  })

  const mfaForm = useForm({
    code: '',
    trust_device: false,
    device_name: '',
  })

  const onLoginSubmit = async (values) => {
    setError('')
    setLoading(true)
    try {
      const res = await login(values.username, values.password)
      if (res.mfa_required) {
        setMfaData(res)
        if (res.device_name) {
          mfaForm.setValue('device_name', res.device_name)
        }
      }
    } catch (err) {
      setError(err.detail || err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const onMfaSubmit = async (values) => {
    setError('')
    setLoading(true)
    try {
      await verifyMfa(mfaData.mfa_token, values.code, values.trust_device, values.device_name)
    } catch (err) {
      setError(err.detail || err.message || 'MFA verification failed')
    } finally {
      setLoading(false)
    }
  }

  const renderLoginForm = () => (
    <>
      <h1 className="mt-0">Login</h1>
      <p className="text-muted" style={{ marginBottom: 24 }}>
        Enter your credentials to access your plants.
      </p>

      {error && <ErrorNotice message={error} />}

      <form onSubmit={loginForm.handleSubmit(onLoginSubmit)}>
        <TextInput
          form={loginForm}
          name="username"
          label="Username"
          placeholder="e.g. jdoe"
          validators={[required()]}
        />
        <div style={{ height: 16 }} />
        <TextInput
          form={loginForm}
          name="password"
          label="Password"
          type="password"
          placeholder="••••••••"
          validators={[required()]}
        />
        <div style={{ height: 24 }} />
        <button type="submit" disabled={loading} className="btn btn-primary" style={buttonStyle}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </>
  )

  const renderMfaForm = () => (
    <>
      <h1 className="mt-0">Two-Factor Auth</h1>
      <p className="text-muted" style={{ marginBottom: 24 }}>
        Please enter the 6-digit code from your authenticator app or a recovery code.
      </p>

      {error && <ErrorNotice message={error} />}

      <form onSubmit={mfaForm.handleSubmit(onMfaSubmit)}>
        <TextInput
          form={mfaForm}
          name="code"
          label="Verification Code"
          placeholder="e.g. 123456 or XXXX-XXXX"
          validators={[required()]}
          autoFocus
        />
        <div style={{ height: 16 }} />
        <Checkbox form={mfaForm} name="trust_device" label="Trust this device" />
        <div style={{ height: 16 }} />
        <TextInput
          form={mfaForm}
          name="device_name"
          label="Device Name"
          placeholder="e.g. My MacBook Pro"
        />
        <div style={{ height: 24 }} />
        <button type="submit" disabled={loading} className="btn btn-primary" style={buttonStyle}>
          {loading ? 'Verifying...' : 'Verify'}
        </button>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn-link"
            onClick={() => setMfaData(null)}
            style={{ fontSize: 14, color: 'var(--text-muted)' }}
          >
            Back to login
          </button>
        </div>
      </form>
    </>
  )

  return (
    <div className="layout" style={containerStyle}>
      <div className="card" style={cardStyle}>
        {mfaData ? renderMfaForm() : renderLoginForm()}

        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 14 }}>
          <Link to="/" className="back-link" style={{ textDecoration: 'none' }}>
            ← Back to Home
          </Link>
        </div>
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
  maxWidth: 400,
  padding: 32,
  borderRadius: 12,
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  boxSizing: 'border-box',
}

const buttonStyle = {
  width: '100%',
  fontWeight: 600,
  fontSize: 16,
}
