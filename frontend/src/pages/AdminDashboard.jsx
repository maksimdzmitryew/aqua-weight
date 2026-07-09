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
import { useSearchParams } from 'react-router-dom'

const adminTabs = [
  { value: 'users', label: 'Users' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

const adminTabValues = new Set(adminTabs.map((tab) => tab.value))

// Common placeholders shared between templates
const COMMON_PLACEHOLDERS = [
  { key: 'date', label: '{{date}}' },
  { key: 'app_name', label: '{{app_name}}' },
  { key: 'admin_username', label: '{{admin_username}}' },
]

// Daily digest specific placeholders
const DAILY_DIGEST_PLACEHOLDERS = [
  { key: 'thirsty_count', label: '{{thirsty_count}}' },
  { key: 'thirsty_list', label: '{{thirsty_list}}' },
  { key: 'helpers_count', label: '{{helpers_count}}' },
  { key: 'weight_list', label: '{{weight_list}}' },
  { key: 'weight_count', label: '{{weight_count}}' },
]

// Thirsty list sub-template placeholders
const THIRSTY_LIST_PLACEHOLDERS = [
  { key: 'name', label: '{{name}}' },
  { key: 'location', label: '{{location}}' },
  { key: 'water_retained_pct', label: '{{water_retained_pct}}' },
  { key: 'min_water_retention', label: '{{min_water_retention}}' },
]

const LOCATION_GROUP_HEADER_PLACEHOLDERS = [
  { key: 'location_group', label: '{{location_group}}' },
  { key: 'location_count', label: '{{location_count}}' },
]

// Weight plants sub-template placeholders
const WEIGHT_PLANTS_PLACEHOLDERS = [
  { key: 'name', label: '{{name}}' },
  { key: 'location', label: '{{location}}' },
  { key: 'measured_weight_g', label: '{{measured_weight_g}}' },
  { key: 'days_since_last_weigh', label: '{{days_since_last_weigh}}' },
]

export default function AdminDashboard() {
  const { effectiveTheme } = useTheme()
  const { user: currentUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
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

  useEffect(() => {
    const tab = searchParams.get('tab')
    setActiveTab(adminTabValues.has(tab) ? tab : 'users')
  }, [searchParams])

  function selectTab(tab) {
    setActiveTab(tab)
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.set('tab', tab)
      return next
    })
  }

  // WhatsApp credentials state
  const [credentials, setCredentials] = useState({
    api_url: '',
    api_token: '',
    template_name: '',
    phone_number_id: '',
  })
  const [credsLoading, setCredsLoading] = useState(true)
  const [credsStatus, setCredsStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'failed'
  const [templateTestStatus, setTemplateTestStatus] = useState('idle') // 'idle' | 'sending' | 'sent' | 'failed'

  // WhatsApp daily digest (free-text template) state
  const [dailyDigest, setDailyDigest] = useState('')
  const [digestLoading, setDigestLoading] = useState(true)
  const [digestStatus, setDigestStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'failed'
  const [digestTestStatus, setDigestTestStatus] = useState('idle') // 'idle' | 'sending' | 'sent' | 'failed'

  // WhatsApp sub-templates state
  const [thirstyListTemplate, setThirstyListTemplate] = useState('')
  const [thirstyListHeaderTemplate, setThirstyListHeaderTemplate] = useState('')
  const [weightPlantsTemplate, setWeightPlantsTemplate] = useState('')
  const [weightPlantsHeaderTemplate, setWeightPlantsHeaderTemplate] = useState('')
  const [thirstyListStatus, setThirstyListStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'failed'
  const [weightPlantsStatus, setWeightPlantsStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'failed'

  const buttonStyle = {
    padding: '8px 16px',
    borderRadius: 6,
    cursor: 'pointer',
  }

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
        ...buttonStyle,
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
        phone_number_id: data.phone_number_id || '',
      })
    } catch {
      // Error is shown in UI via credsStatus
    } finally {
      setCredsLoading(false)
    }
  }

  const loadThirstyListTemplate = async () => {
    try {
      const data = await apiClient.get('/whatsapp/thirsty-list')
      const raw = data?.thirsty_list_template || ''
      if (raw.includes('[[AW_LOCATION_GROUP_HEADER]]')) {
        const afterHeader = raw.split('[[AW_LOCATION_GROUP_HEADER]]', 2)[1] || ''
        if (afterHeader.includes('[[AW_ITEM_TEMPLATE]]')) {
          const parts = afterHeader.split('[[AW_ITEM_TEMPLATE]]', 2)
          setThirstyListHeaderTemplate((parts[0] || '').replace(/^\n+|\n+$/g, ''))
          setThirstyListTemplate((parts[1] || '').replace(/^\n+|\n+$/g, ''))
        } else {
          setThirstyListHeaderTemplate(afterHeader.replace(/^\n+|\n+$/g, ''))
          setThirstyListTemplate('')
        }
      } else {
        setThirstyListHeaderTemplate('')
        setThirstyListTemplate(raw)
      }
    } catch (err) {
      console.error('Failed to load thirsty list template:', err)
    }
  }

  const loadWeightPlantsTemplate = async () => {
    try {
      const data = await apiClient.get('/whatsapp/weight-plants')
      const raw = data?.weight_plants_template || ''
      if (raw.includes('[[AW_LOCATION_GROUP_HEADER]]')) {
        const afterHeader = raw.split('[[AW_LOCATION_GROUP_HEADER]]', 2)[1] || ''
        if (afterHeader.includes('[[AW_ITEM_TEMPLATE]]')) {
          const parts = afterHeader.split('[[AW_ITEM_TEMPLATE]]', 2)
          setWeightPlantsHeaderTemplate((parts[0] || '').replace(/^\n+|\n+$/g, ''))
          setWeightPlantsTemplate((parts[1] || '').replace(/^\n+|\n+$/g, ''))
        } else {
          setWeightPlantsHeaderTemplate(afterHeader.replace(/^\n+|\n+$/g, ''))
          setWeightPlantsTemplate('')
        }
      } else {
        setWeightPlantsHeaderTemplate('')
        setWeightPlantsTemplate(raw)
      }
    } catch (err) {
      console.error('Failed to load weight plants template:', err)
    }
  }

  const handleSaveCredentials = async (e) => {
    e.preventDefault()
    setCredsStatus('saving')
    try {
      await apiClient.post('/whatsapp/credentials', credentials)
      setCredsStatus('saved')
      setTimeout(() => setCredsStatus('idle'), 2000)
    } catch {
      setCredsStatus('failed')
    }
  }

  const handleSendTemplateTest = async () => {
    setTemplateTestStatus('sending')
    try {
      await apiClient.post('/whatsapp/credentials/send-test-template', null)
      setTemplateTestStatus('sent')
      setTimeout(() => setTemplateTestStatus('idle'), 2000)
    } catch {
      setTemplateTestStatus('failed')
    }
  }

  const loadDailyDigest = async () => {
    setDigestLoading(true)
    try {
      const data = await apiClient.get('/whatsapp/daily-digest')
      setDailyDigest(data?.daily_digest || '')
    } catch {
      // Error is shown via digestStatus
    } finally {
      setDigestLoading(false)
    }
  }

  const handleSaveDailyDigest = async (e) => {
    e.preventDefault()
    setDigestStatus('saving')
    try {
      await apiClient.post('/whatsapp/daily-digest', { daily_digest: dailyDigest })
      setDigestStatus('saved')
      setTimeout(() => setDigestStatus('idle'), 2000)
    } catch {
      setDigestStatus('failed')
    }
  }

  const handleSendDailyDigestTest = async () => {
    setDigestTestStatus('sending')
    try {
      await apiClient.post('/whatsapp/daily-digest/send-test', null)
      setDigestTestStatus('sent')
      setTimeout(() => setDigestTestStatus('idle'), 2000)
    } catch {
      setDigestTestStatus('failed')
    }
  }

  const handleInsertDigestPlaceholder = (placeholderLabel) => {
    // Insert placeholder at cursor position
    const textarea = document.getElementById('daily_digest')
    if (textarea && textarea.selectionStart !== undefined) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newText = dailyDigest.slice(0, start) + placeholderLabel + dailyDigest.slice(end)
      setDailyDigest(newText)
      // Restore cursor position after the inserted text
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + placeholderLabel.length, start + placeholderLabel.length)
      }, 0)
    } else {
      setDailyDigest((prev) => {
        const next = (prev || '').trimEnd()
        if (!next) return placeholderLabel
        return `${next}\n${placeholderLabel}`
      })
    }
  }

  const handleInsertThirstyListPlaceholder = (placeholderLabel) => {
    const textarea = document.getElementById('thirsty_list_template')
    if (textarea && textarea.selectionStart !== undefined) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newText =
        thirstyListTemplate.slice(0, start) + placeholderLabel + thirstyListTemplate.slice(end)
      setThirstyListTemplate(newText)
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + placeholderLabel.length, start + placeholderLabel.length)
      }, 0)
    }
  }

  const handleInsertThirstyListHeaderPlaceholder = (placeholderLabel) => {
    const textarea = document.getElementById('thirsty_list_header_template')
    if (textarea && textarea.selectionStart !== undefined) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newText =
        thirstyListHeaderTemplate.slice(0, start) +
        placeholderLabel +
        thirstyListHeaderTemplate.slice(end)
      setThirstyListHeaderTemplate(newText)
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + placeholderLabel.length, start + placeholderLabel.length)
      }, 0)
    }
  }

  const handleInsertWeightPlantsPlaceholder = (placeholderLabel) => {
    const textarea = document.getElementById('weight_plants_template')
    if (textarea && textarea.selectionStart !== undefined) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newText =
        weightPlantsTemplate.slice(0, start) + placeholderLabel + weightPlantsTemplate.slice(end)
      setWeightPlantsTemplate(newText)
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + placeholderLabel.length, start + placeholderLabel.length)
      }, 0)
    }
  }

  const handleInsertWeightPlantsHeaderPlaceholder = (placeholderLabel) => {
    const textarea = document.getElementById('weight_plants_header_template')
    if (textarea && textarea.selectionStart !== undefined) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newText =
        weightPlantsHeaderTemplate.slice(0, start) +
        placeholderLabel +
        weightPlantsHeaderTemplate.slice(end)
      setWeightPlantsHeaderTemplate(newText)
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + placeholderLabel.length, start + placeholderLabel.length)
      }, 0)
    }
  }

  const handleSaveThirstyListTemplate = async (e) => {
    e.preventDefault()
    setThirstyListStatus('saving')
    try {
      const combined = `[[AW_LOCATION_GROUP_HEADER]]\n${(
        thirstyListHeaderTemplate || ''
      ).trim()}\n[[AW_ITEM_TEMPLATE]]\n${(thirstyListTemplate || '').trim()}`
      await apiClient.post('/whatsapp/thirsty-list', { thirsty_list_template: combined })
      setThirstyListStatus('saved')
      setTimeout(() => setThirstyListStatus('idle'), 2000)
    } catch {
      setThirstyListStatus('failed')
    }
  }

  const handleSaveWeightPlantsTemplate = async (e) => {
    e.preventDefault()
    setWeightPlantsStatus('saving')
    try {
      const combined = `[[AW_LOCATION_GROUP_HEADER]]\n${(
        weightPlantsHeaderTemplate || ''
      ).trim()}\n[[AW_ITEM_TEMPLATE]]\n${(weightPlantsTemplate || '').trim()}`
      await apiClient.post('/whatsapp/weight-plants', { weight_plants_template: combined })
      setWeightPlantsStatus('saved')
      setTimeout(() => setWeightPlantsStatus('idle'), 2000)
    } catch {
      setWeightPlantsStatus('failed')
    }
  }

  useEffect(() => {
    if (activeTab === 'whatsapp') {
      loadWhatsAppCredentials()
      loadDailyDigest()
      loadThirstyListTemplate()
      loadWeightPlantsTemplate()
    }
  }, [activeTab])

  const inviteLink = inviteToken
    ? `${window.location.origin}/invite/complete?token=${inviteToken}`
    : ''

  return (
    <DashboardLayout>
      <PageHeader title="Admin Dashboard" subtitle="Manage users and WhatsApp settings" />

      <Tabs tabs={adminTabs} activeTab={activeTab} onChange={selectTab} ariaLabel="Admin tabs" />

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
                style={{
                  marginTop: 24,
                  padding: 16,
                  background: 'var(--sidebar-bg)',
                  borderRadius: 6,
                }}
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
            <h3 style={{ marginBottom: 12 }}>Daily Digest Template</h3>
            <p style={{ marginBottom: 16, color: 'var(--muted)' }}>
              Configure the daily digest message template. Use placeholders like{' '}
              <code>
                {'{'}
                {'{'}date{'}'}
                {'}'}
              </code>{' '}
              to inject values.
            </p>

            {digestLoading ? (
              <p>Loading...</p>
            ) : (
              <form onSubmit={handleSaveDailyDigest} style={{ maxWidth: 720 }}>
                <div style={fieldRow}>
                  <label style={label} htmlFor="daily_digest">
                    Daily Digest Template
                  </label>
                  <textarea
                    id="daily_digest"
                    value={dailyDigest}
                    onChange={(e) => setDailyDigest(e.target.value)}
                    placeholder="Example: Daily digest for {{date}}..."
                    style={{
                      ...styles.input,
                      maxWidth: 720,
                      minHeight: 160,
                      fontFamily: 'inherit',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {COMMON_PLACEHOLDERS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', fontSize: '0.85em' }}
                      onClick={() => handleInsertDigestPlaceholder(p.label)}
                    >
                      {p.label}
                    </button>
                  ))}
                  {DAILY_DIGEST_PLACEHOLDERS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 8px', fontSize: '0.85em' }}
                      onClick={() => handleInsertDigestPlaceholder(p.label)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{
                      ...styles.button,
                      backgroundColor:
                        digestStatus === 'saved'
                          ? '#10b981'
                          : digestStatus === 'failed'
                            ? '#ef4444'
                            : undefined,
                      minWidth: '120px',
                    }}
                    disabled={digestStatus === 'saving'}
                  >
                    {digestStatus === 'saving'
                      ? 'Saving...'
                      : digestStatus === 'saved'
                        ? 'Saved!'
                        : digestStatus === 'failed'
                          ? 'Failed'
                          : 'Save Template'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleSendDailyDigestTest}
                    disabled={digestTestStatus === 'sending' || !dailyDigest.trim()}
                    style={{ ...styles.button, minWidth: '120px' }}
                  >
                    {digestTestStatus === 'sending'
                      ? 'Sending...'
                      : digestTestStatus === 'sent'
                        ? 'Sent!'
                        : digestTestStatus === 'failed'
                          ? 'Failed'
                          : 'Send Test'}
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Thirsty List Sub-template */}
          <section className="card" style={{ marginBottom: 32 }}>
            <h3 style={{ marginBottom: 12 }}>Thirsty List Sub-template</h3>
            <p style={{ marginBottom: 16, color: 'var(--muted)' }}>
              Configure how each thirsty plant appears in the digest. Use placeholders to customize.
            </p>

            <form onSubmit={handleSaveThirstyListTemplate} style={{ maxWidth: 720 }}>
              <div style={fieldRow}>
                <label style={label} htmlFor="thirsty_list_header_template">
                  Thirsty List Location Group Header
                </label>
                <textarea
                  id="thirsty_list_header_template"
                  value={thirstyListHeaderTemplate}
                  onChange={(e) => setThirstyListHeaderTemplate(e.target.value)}
                  placeholder="{{location_group}}"
                  style={{ ...styles.input, maxWidth: 720, minHeight: 70, fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {LOCATION_GROUP_HEADER_PLACEHOLDERS.map((p) => (
                  <button
                    key={`thirsty_header_${p.key}`}
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.85em' }}
                    onClick={() => handleInsertThirstyListHeaderPlaceholder(p.label)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div style={fieldRow}>
                <label style={label} htmlFor="thirsty_list_template">
                  Thirsty List Template
                </label>
                <textarea
                  id="thirsty_list_template"
                  value={thirstyListTemplate}
                  onChange={(e) => setThirstyListTemplate(e.target.value)}
                  placeholder="- {{name}} ({{location}}) water retained: {{water_retained_pct}}"
                  style={{ ...styles.input, maxWidth: 720, minHeight: 100, fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {THIRSTY_LIST_PLACEHOLDERS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.85em' }}
                    onClick={() => handleInsertThirstyListPlaceholder(p.label)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{
                  ...styles.button,
                  backgroundColor:
                    thirstyListStatus === 'saved'
                      ? '#10b981'
                      : thirstyListStatus === 'failed'
                        ? '#ef4444'
                        : undefined,
                  minWidth: '120px',
                }}
                disabled={thirstyListStatus === 'saving'}
              >
                {thirstyListStatus === 'saving'
                  ? 'Saving...'
                  : thirstyListStatus === 'saved'
                    ? 'Saved!'
                    : thirstyListStatus === 'failed'
                      ? 'Failed'
                      : 'Save Template'}
              </button>
            </form>
          </section>

          {/* Weight Plants Sub-template */}
          <section className="card" style={{ marginBottom: 32 }}>
            <h3 style={{ marginBottom: 12 }}>Weight Plants Sub-template</h3>
            <p style={{ marginBottom: 16, color: 'var(--muted)' }}>
              Configure how each plant appears in the weight plants list. Use placeholders to
              customize.
            </p>

            <form onSubmit={handleSaveWeightPlantsTemplate} style={{ maxWidth: 720 }}>
              <div style={fieldRow}>
                <label style={label} htmlFor="weight_plants_header_template">
                  Weight Plants Location Group Header
                </label>
                <textarea
                  id="weight_plants_header_template"
                  value={weightPlantsHeaderTemplate}
                  onChange={(e) => setWeightPlantsHeaderTemplate(e.target.value)}
                  placeholder="{{location_group}}"
                  style={{ ...styles.input, maxWidth: 720, minHeight: 70, fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {LOCATION_GROUP_HEADER_PLACEHOLDERS.map((p) => (
                  <button
                    key={`weight_header_${p.key}`}
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.85em' }}
                    onClick={() => handleInsertWeightPlantsHeaderPlaceholder(p.label)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div style={fieldRow}>
                <label style={label} htmlFor="weight_plants_template">
                  Weight Plants Template
                </label>
                <textarea
                  id="weight_plants_template"
                  value={weightPlantsTemplate}
                  onChange={(e) => setWeightPlantsTemplate(e.target.value)}
                  placeholder="- {{name}} ({{location}}): {{measured_weight_g}}, last weighed: {{days_since_last_weigh}}"
                  style={{ ...styles.input, maxWidth: 720, minHeight: 100, fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {WEIGHT_PLANTS_PLACEHOLDERS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.85em' }}
                    onClick={() => handleInsertWeightPlantsPlaceholder(p.label)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{
                  ...styles.button,
                  backgroundColor:
                    weightPlantsStatus === 'saved'
                      ? '#10b981'
                      : weightPlantsStatus === 'failed'
                        ? '#ef4444'
                        : undefined,
                  minWidth: '120px',
                }}
                disabled={weightPlantsStatus === 'saving'}
              >
                {weightPlantsStatus === 'saving'
                  ? 'Saving...'
                  : weightPlantsStatus === 'saved'
                    ? 'Saved!'
                    : weightPlantsStatus === 'failed'
                      ? 'Failed'
                      : 'Save Template'}
              </button>
            </form>
          </section>

          <section style={{ marginBottom: 32 }}>
            <h3 style={{ marginBottom: 16 }}>API Credentials</h3>
            {credsLoading ? (
              <p>Loading...</p>
            ) : (
              <form onSubmit={handleSaveCredentials} style={{ maxWidth: 520 }}>
                <div style={fieldRow}>
                  <label style={label} htmlFor="api_url">
                    API URL *
                  </label>
                  <input
                    id="api_url"
                    type="text"
                    value={credentials.api_url}
                    onChange={(e) => setCredentials({ ...credentials, api_url: e.target.value })}
                    placeholder="https://graph.facebook.com/v18.0/{phone_number_id}/messages"
                    style={styles.input}
                  />
                </div>

                <div style={fieldRow}>
                  <label style={label} htmlFor="api_token">
                    API Token *
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
                    onChange={(e) =>
                      setCredentials({ ...credentials, template_name: e.target.value })
                    }
                    placeholder="jaspers_market_plain_text_v1"
                    style={styles.input}
                  />
                </div>

                <div style={fieldRow}>
                  <label style={label} htmlFor="phone_number_id">
                    Phone Number ID
                  </label>
                  <input
                    id="phone_number_id"
                    type="text"
                    value={credentials.phone_number_id}
                    onChange={(e) =>
                      setCredentials({ ...credentials, phone_number_id: e.target.value })
                    }
                    placeholder="Your WhatsApp phone number ID"
                    style={styles.input}
                  />
                </div>

                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      style={{
                        ...styles.button,
                        backgroundColor:
                          credsStatus === 'saved'
                            ? '#10b981'
                            : credsStatus === 'failed'
                              ? '#ef4444'
                              : undefined,
                        minWidth: '160px',
                      }}
                      disabled={credsStatus === 'saving'}
                    >
                      {credsStatus === 'saving'
                        ? 'Saving...'
                        : credsStatus === 'saved'
                          ? 'Saved!'
                          : credsStatus === 'failed'
                            ? 'Failed'
                            : 'Save Credentials'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleSendTemplateTest}
                      disabled={templateTestStatus === 'sending'}
                      style={{ ...styles.button, minWidth: '160px' }}
                    >
                      {templateTestStatus === 'sending'
                        ? 'Sending...'
                        : templateTestStatus === 'sent'
                          ? 'Sent!'
                          : templateTestStatus === 'failed'
                            ? 'Failed'
                            : 'Send Template Test'}
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
