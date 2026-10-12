import React, { useState, useEffect } from 'react'
import { Users as UsersIcon, Plus, Trash2, KeyRound, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'
import { adminService } from '../../services/adminService'
import { Admin } from '../../types/auth'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatDate } from '@meruveda/shared'
import { Modal, ConfirmDialog } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<Admin[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)

  // Form states
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'customer'>('customer')
  const [avatar, setAvatar] = useState('')

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const data = await adminService.getAdmins()
      setUsers(data)
    } catch (err) {
      toast.error('Failed to load user accounts')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const openAdd = () => {
    setFirstName('')
    setLastName('')
    setEmail('')
    setPassword('')
    setRole('customer')
    setAvatar('')
    setIsAddOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!firstName || !email || !password) {
      toast.error('First Name, Email, and Password are required.')
      return
    }

    const payload = {
      firstName,
      lastName,
      email,
      password,
      role,
      avatar: avatar || undefined,
      isActive: true,
    }

    try {
      await adminService.createAdmin(payload as any)
      toast.success('User account created successfully!')
      setIsAddOpen(false)
      fetchUsers()
    } catch (err) {
      toast.error('Failed to create account')
    }
  }

  const handleToggle = async (id: string, current: boolean) => {
    try {
      await adminService.toggleAdminStatus(id, !current)
      toast.success(current ? 'Account disabled' : 'Account activated')
      fetchUsers()
    } catch (err) {
      toast.error('Failed to update status')
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await adminService.deleteAdmin(deleteId)
      toast.success('User deleted successfully')
      fetchUsers()
    } catch (err) {
      toast.error('Failed to delete account')
    } finally {
      setDeleteId(null)
    }
  }

  const handleResetPassword = async () => {
    if (!resetId) return
    try {
      await adminService.resetPassword(resetId)
      toast.success('Password reset instructions generated!')
    } catch (err) {
      toast.error('Failed to reset password')
    } finally {
      setResetId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">User Accounts</h1>
          <p className="text-sm text-slate-500">Manage all system users, assign roles, toggle access, and reset passwords.</p>
        </div>
        <button
          onClick={openAdd}
          className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
        >
          <Plus className="h-4 w-4" /> Create User
        </button>
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4">User</th>
                <th className="p-4">Email</th>
                <th className="p-4">Role</th>
                <th className="p-4">Created Date</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Loading accounts...
                  </td>
                </tr>
              ) : (
                users.map((usr) => {
                  const displayName = usr.name || usr.email || 'Unknown';
                  return (
                    <tr key={usr.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={usr.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'}
                            alt={displayName}
                            className="h-9 w-9 rounded-full object-cover border"
                          />
                          <span className="font-semibold text-slate-900 dark:text-white">{displayName}</span>
                        </div>
                      </td>
                      <td className="p-4 text-slate-600 dark:text-slate-350">{usr.email}</td>
                      <td className="p-4">
                        <select
                          value={usr.role}
                          onChange={async (e) => {
                            const newRole = e.target.value as 'admin' | 'customer';
                            try {
                              await adminService.updateAdmin(usr.id, { role: newRole });
                              toast.success(`Role updated to ${newRole}`);
                              fetchUsers();
                            } catch (err) {
                              toast.error('Failed to update role');
                            }
                          }}
                          className="bg-slate-100 dark:bg-slate-800 text-xs font-bold uppercase text-slate-600 dark:text-slate-300 rounded-lg px-2 py-1 border-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
                        >
                          <option value="customer">Customer</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="p-4 text-xs text-slate-500">{formatDate(usr.createdAt)}</td>
                      <td className="p-4">
                        <StatusBadge status={usr.isActive ? 'active' : 'inactive'} />
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleToggle(usr.id, usr.isActive)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500"
                            title={usr.isActive ? 'Disable Account' : 'Activate Account'}
                          >
                            {usr.isActive ? (
                              <ToggleRight className="h-5 w-5 text-green-600" />
                            ) : (
                              <ToggleLeft className="h-5 w-5 text-slate-400" />
                            )}
                          </button>
                          <button
                            onClick={() => setResetId(usr.id)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-blue-600"
                            title="Reset Password"
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteId(usr.id)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-red-500"
                            title="Delete Account"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Create User Account">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First Name *</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="e.g. Aarav"
                className="input"
              />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="e.g. Sharma"
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="label">Email Address *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. aarav@meruveda.com"
              className="input"
            />
          </div>

          <div>
            <label className="label">Password *</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input"
            />
          </div>

          <div>
            <label className="label">Role *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'customer')}
              className="select w-full bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-2.5 text-sm"
            >
              <option value="customer">Customer</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="label">Avatar Image URL (Optional)</label>
            <input
              type="text"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="https://images.unsplash.com/photo-..."
              className="input"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="btn-outline px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary px-4 py-2 text-xs">
              Create User
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete User Account dialog */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete User Account"
        message="Are you sure you want to permanently delete this user account? They will lose access to the platform immediately."
        isDestructive
      />

      {/* Reset Password dialog */}
      <ConfirmDialog
        isOpen={!!resetId}
        onClose={() => setResetId(null)}
        onConfirm={handleResetPassword}
        title="Reset Password"
        message="Are you sure you want to trigger a password reset for this user?"
      />
    </div>
  )
}
export default UsersPage
