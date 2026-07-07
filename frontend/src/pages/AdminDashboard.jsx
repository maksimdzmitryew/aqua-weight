import React, { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { apiClient } from '../api/client'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import Badge from '../components/Badge.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import Tabs from '../components/Tabs.jsx'
import { useTheme } from '../ThemeContext.jsx'

const adminTabs = [
  { value: 'users', label: 'Users' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

const DAILY_DIGEST_PLACEHOLDERS = [
  { key: 'date', label: '{{date}}' },
  { key: 'thirsty_count', label: '{{thirsty_count}}' },
  { key: 'thirsty_list', label: '{{thirsty_list}}' },
  { key: 'helpers_count', label: '{{helpers_count}}' },
  { key: 'admin_username', label: '{{admin_username}}' },
]

export default function AdminDashboard() {
  const { effectiveTheme } = useTheme()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [inviteToken, setInviteToken] = useState(null)
  const [inviteExpires, setInviteExpires] = useState(null)
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false)
  const [confirmReset, setConfirmReset] = useState(null)
  const [confirmRole, setConfirmRole] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState('users')

  // WhatsApp credentials state
  const [credentials, setCredentials] = useState({ api_url: '', api_token: '', template_name: '' })
  const [credsLoading, setCredsLoading] = useState(true)
  const [savingCreds, setSavingCreds] = useState(false)
  const [credsError, setCredsError] = useState('')
  const [credsSaved, setCredsSaved] = useState('')
  const [sendingTemplateTest, setSendingTemplateTest] = useState(false)
  const [templateTestError, setTemplateTestError] = useState('')
  const [templateTestSent, setTemplateTestSent] = useState('')

  // WhatsApp daily digest (free-text template) state
  const [dailyDigest, setDailyDigest] = useState('')
  const [digestLoading, setDigestLoading] = useState(true)
  const [savingDigest, setSavingDigest] = useState(false)
  const [digestError, setDigestError] = useState('')
  const [digestSaved, setDigestSaved] = useState('')
  const [sendingDigestTest, setSendingDigestTest] = useState(false)
  const [digestTestError, setDigestTestError] = useState('')
  const [digestTestSent, setDigestTestSent] = useState('')

  const styles = useMemo(() => {
    const isDark = effectiveTheme === 'dark'
    return {
      input: {
        padding: '8px 10px',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        background: isDark ? '#111827' : '#ffffff',
        color: isDark ? '#f9fafb' : '#111827',
        width: '100%',
        maxWidth: 500,
      },
      button: {
        padding: '8px 16px',
        background: isDark ? '#111827' : '#111827',
        color: 'white',
        border: 0,
        borderRadius: 6,
        cursor: 'pointer',
      },
    }
  }, [effectiveTheme])

  const fieldRow = { display: 'flex', flexDirection: 'column', marginBottom: 12 }
  const label = { fontWeight: 600, marginBottom: 6 }

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const data = await apiClient.get('/admin/users')
      setUsers(data.users || [])
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleToggleRole = async (user) => {
    if (!user) return
    const newRole = user.global_role === 'admin' ? 'customer' : 'admin'
    setIsProcessing(true)
    try {
      await apiClient.patch(`/admin/users/${user.id_hex}/role`, { global_role: newRole })
      setUsers((prev) =>
        prev.map((u) => (u.id_hex === user.id_hex ? { ...u, global_role: newRole } : u)),
      )
      setConfirmRole(null)
    } catch (err) {
      alert(err.message || 'Failed to update role')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleResetMfa = async () => {
    if (!confirmReset) return
    setIsProcessing(true)
    try {
      await apiClient.post(`/admin/users/${confirmReset.id_hex}/mfa-reset`)
      setUsers((prev) =>
        prev.map((u) => (u.id_hex === confirmReset.id_hex ? { ...u, mfa_enabled: false } : u)),
      )
      setConfirmReset(null)
    } catch (err) {
      alert(err.message || 'Failed to reset MFA')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleGenerateInvite = async () => {
    setIsGeneratingInvite(true)
    try {
      const data = await apiClient.post('/admin/invites', { expires_in_days: 7 })
      setInviteToken(data.token)
      setInviteExpires(data.expires_at)
    } catch (err) {
      alert(err.message || 'Failed to generate invite')
    } finally {
      setIsGeneratingInvite(false)
    }
  }

  // WhatsApp functions
  const loadWhatsAppCredentials = async () => {
    setCredsLoading(true)
    try {
      const data = await apiClient.get('/whatsapp/credentials')
      setCredentials({
        api_url: data.api_url || '',
        api_token: data.api_token || '',
        template_name: data.template_name || '',
      })
    } catch (err) {
      setCredsError(err.detail || 'Failed to load credentials')
    } finally {
      setCredsLoading(false)
    }
  }

  const handleSaveCredentials = async (e) => {
    e.preventDefault()
    setSavingCreds(true)
    setCredsError('')
    try {
      await apiClient.post('/whatsapp/credentials', credentials)
      setCredsSaved('Saved!')
      setTimeout(() => setCredsSaved(''), 2000)
    } catch (err) {
      setCredsError(err.detail || 'Failed to save credentials')
    } finally {
      setSavingCreds(false)
    }
  }

  const handleSendTemplateTest = async () => {
    setSendingTemplateTest(true)
    setTemplateTestError('')
    setTemplateTestSent('')
    try {
      await apiClient.post('/whatsapp/credentials/send-test-template', null)
      setTemplateTestSent('Sent!')
      setTimeout(() => setTemplateTestSent(''), 2000)
    } catch (err) {
      setTemplateTestError(err.detail || 'Failed to send template test')
    } finally {
      setSendingTemplateTest(false)
    }
  }

  const loadDailyDigest = async () => {
    setDigestLoading(true)
    setDigestError('')
    try {
      const data = await apiClient.get('/whatsapp/daily-digest')
      setDailyDigest(data?.daily_digest || '')
    } catch (err) {
      setDigestError(err.detail || 'Failed to load daily digest')
    } finally {
      setDigestLoading(false)
    }
  }

  const handleSaveDailyDigest = async (e) => {
    e.preventDefault()
    setSavingDigest(true)
    setDigestError('')
    try {
      await apiClient.post('/whatsapp/daily-digest', { daily_digest: dailyDigest })
      setDigestSaved('Saved!')
      setTimeout(() => setDigestSaved(''), 2000)
    } catch (err) {
      setDigestError(err.detail || 'Failed to save daily digest')
    } finally {
      setSavingDigest(false)
    }
  }

  const handleSendDailyDigestTest = async () => {
    setSendingDigestTest(true)
    setDigestTestError('')
    setDigestTestSent('')
    try {
      await apiClient.post('/whatsapp/daily-digest/send-test', null)
      setDigestTestSent('Sent!')
      setTimeout(() => setDigestTestSent(''), 2000)
    } catch (err) {
      setDigestTestError(err.detail || 'Failed to send test')
    } finally {
      setSendingDigestTest(false)
    }
  }

  const handleInsertDigestPlaceholder = (placeholderLabel) => {
    setDailyDigest((prev) => {
      const next = (prev || '').trimEnd()
      if (!next) return placeholderLabel
      // Keep insertion simple: append placeholder on a new line.
      return `${next}\n${placeholderLabel}`
    })
  }

  useEffect(() => {
    if (activeTab === 'whatsapp') {
      loadWhatsAppCredentials()
      loadDailyDigest()
    }
  }, [activeTab])

  const inviteLink = inviteToken
    ? `${window.location.origin}/invite/complete?token=${inviteToken}`
    : ''

  return (
    <DashboardLayout>
      <PageHeader title="Admin Dashboard" subtitle="Manage users and WhatsApp settings" />

      <Tabs tabs={adminTabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Admin tabs" />

      {/* Users Tab */}
      {activeTab === 'users' && (
        <>
          <section style={{ marginBottom: 32 }}>
            <h3 style={{ marginBottom: 16 }}>User Management</h3>
            {loading ? (
              <Loader label="Loading users..." />
            ) : error ? (
              <ErrorNotice message={error} onRetry={fetchUsers} />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="th">Username</th>
                      <th className="th">Role</th>
                      <th className="th">MFA Status</th>
                      <th className="th">Created</th>
                      <th className="th">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id_hex}>
                        <td className="td">{user.username}</td>
                        <td className="td">
                          <Badge tone={user.global_role === 'admin' ? 'warning' : 'neutral'}>
                            {user.global_role}
                          </Badge>
                        </td>
                        <td className="td">
                          {user.mfa_enabled ? (
                            <Badge tone="success">Enabled</Badge>
                          ) : (
                            <Badge tone="neutral">Disabled</Badge>
                          )}
                        </td>
                        <td className="td">{new Date(user.created_at).toLocaleDateString()}</td>
                        <td className="td">
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.85em' }}
                              onClick={() => setConfirmRole(user)}
                              disabled={isProcessing}
                            >
                              Make {user.global_role === 'admin' ? 'Customer' : 'Admin'}
                            </button>
                            <button
                              className="btn btn-danger"
                              style={{ padding: '4px 8px', fontSize: '0.85em' }}
                              onClick={() => setConfirmReset(user)}
                              disabled={
                                !user.mfa_enabled ||
                                user.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase() ||
                                isProcessing
                              }
                            >
                              Reset MFA
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h3 style={{ marginBottom: 12 }}>Generate Invitation</h3>
            <p style={{ marginBottom: 16, color: 'var(--muted)' }}>
              Create a one-time use token for a new user to register.
            </p>
            <button
              className="btn btn-primary"
              onClick={handleGenerateInvite}
              disabled={isGeneratingInvite}
            >
              {isGeneratingInvite ? 'Generating...' : 'Create Invite Link'}
            </button>

            {inviteToken && (
              <div
                style={{ marginTop: 24, padding: 16, background: 'var(--sidebar-bg)', borderRadius: 6 }}
              >
                <p style={{ fontWeight: 600, marginBottom: 8 }}>Invite Link (Valid for 7 days):</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    className="input"
                    style={{ flex: 1 }}
                    onClick={(e) => e.target.select()}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteLink)
                        alert('Copied to clipboard!')
                      } catch (err) {
                        alert('Failed to copy: ' + (err.message || 'unknown error'))
                      }
                    }}
                  >
                    Copy
                  </button>
                </div>
                <p style={{ fontSize: '0.85em', color: 'var(--muted)', marginTop: 8 }}>
                  Expires at: {new Date(inviteExpires).toLocaleString()}
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {/* WhatsApp Tab */}
      {activeTab === 'whatsapp' && (
        <div>
          <section className="card" style={{ marginBottom: 32 }}>
            <h3 style={{ marginBottom: 12 }}>Daily Digest (Free Text)</h3>
            <p style={{ marginBottom: 16, color: 'var(--muted)' }}>
              Configure the daily digest message template. Use placeholders like{' '}
              <code>{'{'}{'{'}date{'}'}{'}'}</code> to inject values.
            </p>

            {digestLoading ? (
              <p>Loading...</p>
            ) : (
              <form onSubmit={handleSaveDailyDigest} style={{ maxWidth: 720 }}>
                <div style={fieldRow}>
                  <label style={label} htmlFor="daily_digest">
                    Template
                  </label>
                  <textarea
                    id="daily_digest"
                    value={dailyDigest}
                    onChange={(e) => setDailyDigest(e.target.value)}
                    placeholder="Example: Daily digest for {{date}}..."
                    style={{ ...styles.input, maxWidth: 720, minHeight: 160, fontFamily: 'inherit' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {DAILY_DIGEST_PLACEHOLDERS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleInsertDigestPlaceholder(p.label)}
                    >
                      Insert {p.label}
                    </button>
                  ))}
                </div>

                {digestError && <p style={{ color: 'crimson' }}>{digestError}</p>}
                {digestSaved && <p style={{ color: 'seagreen' }}>{digestSaved}</p>}
                {digestTestError && <p style={{ color: 'crimson' }}>{digestTestError}</p>}
                {digestTestSent && <p style={{ color: 'seagreen' }}>{digestTestSent}</p>}

                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <button type="submit" style={styles.button} disabled={savingDigest}>
                    {savingDigest ? 'Saving...' : 'Save Template'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleSendDailyDigestTest}
                    disabled={sendingDigestTest || !dailyDigest.trim()}
                  >
                    {sendingDigestTest ? 'Sending...' : 'Send Test'}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section style={{ marginBottom: 32 }}>
            <h3 style={{ marginBottom: 16 }}>API Credentials</h3>
            {credsLoading ? (
              <p>Loading...</p>
            ) : (
              <form onSubmit={handleSaveCredentials} style={{ maxWidth: 520 }}>
                <div style={fieldRow}>
                  <label style={label} htmlFor="api_url">
                    API URL
                  </label>
                  <input
                    id="api_url"
                    type="text"
                    value={credentials.api_url}
                    onChange={(e) => setCredentials({ ...credentials, api_url: e.target.value })}
                    placeholder="https://graph.facebook.com/v18.0/..."
                    style={styles.input}
                  />
                </div>

                <div style={fieldRow}>
                  <label style={label} htmlFor="api_token">
                    API Token
                  </label>
                  <input
                    id="api_token"
                    type="password"
                    value={credentials.api_token}
                    onChange={(e) => setCredentials({ ...credentials, api_token: e.target.value })}
                    placeholder="WhatsApp API access token"
                    style={styles.input}
                  />
                </div>

                <div style={fieldRow}>
                  <label style={label} htmlFor="template_name">
                    Template Name
                  </label>
                  <input
                    id="template_name"
                    type="text"
                    value={credentials.template_name}
                    onChange={(e) => setCredentials({ ...credentials, template_name: e.target.value })}
                    placeholder="jaspers_market_plain_text_v1"
                    style={styles.input}
                  />
                </div>

                {credsError && <p style={{ color: 'crimson' }}>{credsError}</p>}
                {credsSaved && <p style={{ color: 'seagreen' }}>{credsSaved}</p>}
                {templateTestError && <p style={{ color: 'crimson' }}>{templateTestError}</p>}
                {templateTestSent && <p style={{ color: 'seagreen' }}>{templateTestSent}</p>}

                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="submit" style={styles.button} disabled={savingCreds}>
                      {savingCreds ? 'Saving...' : 'Save Credentials'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleSendTemplateTest}
                      disabled={sendingTemplateTest}
                    >
                      {sendingTemplateTest ? 'Sending...' : 'Send Template Test'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={!!confirmReset}
        title="Reset MFA?"
        message={
          confirmReset
            ? `Are you sure you want to reset MFA for "${confirmReset.username}"? This will also revoke all their active sessions.`
            : ''
        }
        confirmText={isProcessing ? 'Processing...' : 'Reset MFA'}
        onConfirm={handleResetMfa}
        onCancel={() => setConfirmReset(null)}
        tone="danger"
        disabled={isProcessing}
      />

      <ConfirmDialog
        open={!!confirmRole}
        title={
          confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
            ? 'Action Not Permitted'
            : confirmRole?.global_role === 'admin'
              ? 'Demote to Customer?'
              : 'Promote to Admin?'
        }
        message={
          confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
            ? 'You cannot change your own role.'
            : confirmRole
              ? `Are you sure you want to change "${confirmRole.username}"'s role to ${
                  confirmRole.global_role === 'admin' ? 'customer' : 'admin'
                }?`
              : ''
        }
        confirmText={
          confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
            ? 'OK'
            : isProcessing
              ? 'Processing...'
              : confirmRole?.global_role === 'admin'
                ? 'Make Customer'
                : 'Make Admin'
        }
        onConfirm={
          confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
            ? () => setConfirmRole(null)
            : () => handleToggleRole(confirmRole)
        }
        onCancel={() => setConfirmRole(null)}
        cancelText={
          confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase() ? null : 'Cancel'
        }
        tone={
          confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
            ? 'info'
            : confirmRole?.global_role === 'admin'
              ? 'warning'
              : 'info'
        }
        disabled={isProcessing}
      />
    </DashboardLayout>
  )
}
