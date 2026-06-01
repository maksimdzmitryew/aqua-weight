import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { apiClient } from '../api/client'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../context/AuthContext.jsx'

export default function MFASetup() {
  const { user } = useAuth()
  const [step, setStep] = useState(1) // 1: Secret, 2: Verify, 3: Recovery Codes
  const [secret, setSecret] = useState(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchSecret = async () => {
      setLoading(true)
      try {
        const data = await apiClient.get('/mfa/enroll')
        setSecret(data.secret)
      } catch (err) {
        setError(err.message || 'Failed to start MFA enrollment')
      } finally {
        setLoading(false)
      }
    }
    fetchSecret()
  }, [])

  const handleVerify = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const data = await apiClient.post('/mfa/enroll', {
        secret,
        code
      })
      setRecoveryCodes(data.recovery_codes || [])
      setStep(3)
    } catch (err) {
      setError(err.message || 'Verification failed. Please check the code and try again.')
    } finally {
      setLoading(false)
    }
  }

  const username = user?.username || 'user'
  const otpauthUrl = secret ? `otpauth://totp/AW:${username}?secret=${secret}&issuer=AW` : ''

  if (loading && step === 1) {
    return (
      <DashboardLayout>
        <Loader label="Initializing MFA setup..." />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <PageHeader title="MFA Setup" subtitle="Secure your account with two-factor authentication" />

      <div className="card" style={{ maxWidth: 600, margin: '20px auto' }}>
        {step === 1 && (
          <div>
            <h3 style={{ marginBottom: 12 }}>Step 1: Scan QR Code</h3>
            <p style={{ marginBottom: 20, color: 'var(--muted)' }}>
              Scan the QR code below with your authenticator app (e.g., Google Authenticator, Authy, or 1Password).
            </p>
            
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24, background: '#fff', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
              {secret ? (
                <QRCodeSVG value={otpauthUrl} size={200} />
              ) : (
                <div style={{ height: 200, width: 200, background: 'var(--sidebar-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  No secret available
                </div>
              )}
            </div>

            <p style={{ fontSize: '0.9em', color: 'var(--muted)', marginBottom: 8 }}>
              Can't scan? Enter this secret manually in your app:
            </p>
            <code style={{ display: 'block', padding: 12, background: 'var(--sidebar-bg)', borderRadius: 4, letterSpacing: 2, textAlign: 'center', fontSize: '1.2em', border: '1px dashed var(--border)' }}>
              {secret}
            </code>

            <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                I've scanned it, continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={handleVerify}>
            <h3 style={{ marginBottom: 12 }}>Step 2: Verify Code</h3>
            <p style={{ marginBottom: 20, color: 'var(--muted)' }}>
              Enter the 6-digit code from your authenticator app to verify the setup.
            </p>

            {error && <ErrorNotice message={error} style={{ marginBottom: 16 }} />}

            <div style={{ marginBottom: 24 }}>
              <label htmlFor="mfa-code" style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
                Verification Code
              </label>
              <input
                id="mfa-code"
                type="text"
                className="input"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                style={{ fontSize: '1.8em', textAlign: 'center', letterSpacing: '0.3em', height: 'auto', padding: '12px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} disabled={loading}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading || code.length !== 6}>
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <div>
            <h3 style={{ marginBottom: 12, color: '#10b981' }}>Step 3: Recovery Codes</h3>
            <p style={{ marginBottom: 16 }}>
              MFA is now enabled! <strong>Save these recovery codes.</strong> If you lose your device, these are the ONLY way to access your account.
            </p>
            <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 20 }}>
              Each code can only be used once. Store them in a secure place (like a password manager).
            </p>

            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: 12, 
              padding: 20, 
              background: 'var(--sidebar-bg)', 
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: '1.1em',
              border: '1px solid var(--border)',
              marginBottom: 24
            }}>
              {recoveryCodes.map((c, i) => (
                <div key={i}>{c}</div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  const text = recoveryCodes.join('\n')
                  navigator.clipboard.writeText(text)
                  alert('Codes copied to clipboard!')
                }}
              >
                Copy to Clipboard
              </button>
              <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
                I've saved them, finish
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
