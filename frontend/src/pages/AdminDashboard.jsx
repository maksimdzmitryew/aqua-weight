import React, { useEffect, useState } from 'react'
import DashboardLayout from '../components/DashboardLayout.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { apiClient } from '../api/client'
import Loader from '../components/feedback/Loader.jsx'
import ErrorNotice from '../components/feedback/ErrorNotice.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import Badge from '../components/Badge.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function AdminDashboard() {
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
      setUsers(prev => prev.map(u => u.id_hex === user.id_hex ? { ...u, global_role: newRole } : u))
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
      setUsers(prev => prev.map(u => u.id_hex === confirmReset.id_hex ? { ...u, mfa_enabled: false } : u))
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

  const inviteLink = inviteToken ? `${window.location.origin}/invite/complete?token=${inviteToken}` : ''

  return (
    <DashboardLayout>
      <PageHeader title="Admin Dashboard" subtitle="Manage users and invitations" />

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
                {users.map(user => (
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
                          disabled={!user.mfa_enabled || user.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase() || isProcessing}
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
          <div style={{ marginTop: 24, padding: 16, background: 'var(--sidebar-bg)', borderRadius: 6 }}>
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

      <ConfirmDialog
        open={!!confirmReset}
        title="Reset MFA?"
        message={confirmReset ? `Are you sure you want to reset MFA for "${confirmReset.username}"? This will also revoke all their active sessions.` : ''}
        confirmText={isProcessing ? 'Processing...' : 'Reset MFA'}
        onConfirm={handleResetMfa}
        onCancel={() => setConfirmReset(null)}
        tone="danger"
        disabled={isProcessing}
      />

      <ConfirmDialog
        open={!!confirmRole}
        title={confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase() 
          ? "Action Not Permitted" 
          : (confirmRole?.global_role === 'admin' ? 'Demote to Customer?' : 'Promote to Admin?')
        }
        message={confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
          ? "You cannot change your own role."
          : (confirmRole ? `Are you sure you want to change "${confirmRole.username}"'s role to ${confirmRole.global_role === 'admin' ? 'customer' : 'admin'}?` : '')
        }
        confirmText={confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
          ? "OK"
          : (isProcessing ? 'Processing...' : (confirmRole?.global_role === 'admin' ? 'Make Customer' : 'Make Admin'))
        }
        onConfirm={confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
          ? () => setConfirmRole(null)
          : () => handleToggleRole(confirmRole)
        }
        onCancel={() => setConfirmRole(null)}
        cancelText={confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase() ? null : "Cancel"}
        tone={confirmRole?.id_hex?.toLowerCase() === currentUser?.id?.toLowerCase()
          ? "info"
          : (confirmRole?.global_role === 'admin' ? 'warning' : 'info')
        }
        disabled={isProcessing}
      />
    </DashboardLayout>
  )
}
