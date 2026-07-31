'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { RoleGuard } from '@/components/RoleGuard'
import { Modal } from '@/components/Modal'
import { SessionUser, User, PendingAccount } from '@/types'
import { getSession } from '@/lib/auth'
import { formatDate, formatDateTime } from '@/lib/format'
import { useToast } from '@/context/ToastContext'
import { validateStaffForm } from '@/lib/validators'
import { Search, Users, CheckCircle2, Slash, Plus, Edit3, Trash2, Save, Clock, XCircle, UserPlus, Smartphone } from 'lucide-react'

interface CashierDeviceApproval {
  id: string
  user_id: string
  device_id: string
  device_name: string
  device_info?: string | Record<string, any>
  device_location?: string
  status: string
  requested_duration_hours: number
  approved_duration_hours?: number
  expires_at?: string
  reviewed_by?: string
  reviewed_at?: string
  created_at: string
  updated_at: string
  user?: { full_name: string; email: string }
}

export default function StaffPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [staff, setStaff] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingStaff, setEditingStaff] = useState<User | null>(null)
  const [staffForm, setStaffForm] = useState({ full_name: '', email: '', role: 'cashier' as 'owner' | 'cashier', pin: '', is_active: true })
  const [staffErrors, setStaffErrors] = useState<Record<string, string>>({})
  const [savingStaff, setSavingStaff] = useState(false)
  const [pendingRequests, setPendingRequests] = useState<PendingAccount[]>([])
  const [showPending, setShowPending] = useState(false)
  const [reviewingRequest, setReviewingRequest] = useState<PendingAccount | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pendingDevices, setPendingDevices] = useState<CashierDeviceApproval[]>([])
  const [activeDevices, setActiveDevices] = useState<CashierDeviceApproval[]>([])
  const [showDevices, setShowDevices] = useState(false)
  const [reviewingDevice, setReviewingDevice] = useState<CashierDeviceApproval | null>(null)
  const [approvingDevice, setApprovingDevice] = useState(false)
  const [revokingDevice, setRevokingDevice] = useState(false)
  const toast = useToast()
  const supabase = createClient()

  useEffect(() => {
    const session = getSession()
    if (!session) {
      router.push('/login')
      return
    }
    setUser(session)
  }, [])

  useEffect(() => {
    if (user) fetchStaff()
  }, [user])

  function resetStaffForm() {
    setStaffForm({ full_name: '', email: '', role: 'cashier', pin: '', is_active: true })
    setStaffErrors({})
    setEditingStaff(null)
  }

  function openNewStaff() {
    resetStaffForm()
    setModalOpen(true)
  }

  function openEditStaff(member: User) {
    setEditingStaff(member)
    setStaffForm({
      full_name: member.full_name || '',
      email: member.email || '',
      role: member.role || 'cashier',
      pin: '',
      is_active: member.is_active,
    })
    setStaffErrors({})
    setModalOpen(true)
  }

  async function handleSaveStaff() {
    const validation = editingStaff || staffForm.pin.trim()
      ? validateStaffForm({ full_name: staffForm.full_name, email: staffForm.email, pin: editingStaff ? staffForm.pin || '0000' : staffForm.pin })
      : validateStaffForm({ full_name: staffForm.full_name, email: staffForm.email, pin: staffForm.pin })

    if (!validation.isValid) {
      setStaffErrors(Object.fromEntries(validation.errors.map(error => [error.field, error.message])))
      return
    }

    setSavingStaff(true)
    try {
      const payload = {
        full_name: staffForm.full_name.trim(),
        email: staffForm.email.trim(),
        role: staffForm.role,
        is_active: staffForm.is_active,
      }

      if (!editingStaff || staffForm.pin.trim()) {
        Object.assign(payload, { pin: staffForm.pin.trim() })
      }

      if (editingStaff) {
        const { error } = await supabase.from('users').update(payload).eq('id', editingStaff.id).single()
        if (error) throw error
        toast.success('Staff updated successfully')
      } else {
        const { error } = await supabase.from('users').insert(payload)
        if (error) throw error
        toast.success('Staff added successfully')
      }

      setModalOpen(false)
      resetStaffForm()
      fetchStaff()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save staff'
      toast.error(message)
    } finally {
      setSavingStaff(false)
    }
  }

  async function toggleStaffStatus(member: User) {
    try {
      const { error } = await supabase.from('users').update({ is_active: !member.is_active }).eq('id', member.id)
      if (error) throw error
      toast.success(`${member.is_active ? 'Deactivated' : 'Activated'} staff member`)
      fetchStaff()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update staff status'
      toast.error(message)
    }
  }

  async function handleDeleteStaff(member: User) {
    if (!member.id) return
    const confirmed = window.confirm(`Delete staff ${member.full_name}? This cannot be undone.`)
    if (!confirmed) return

    setLoading(true)
    try {
      const { error } = await supabase.from('users').delete().eq('id', member.id)
      if (error) throw error
      toast.success(`Deleted ${member.full_name}`)
      fetchStaff()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to delete staff'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleApproveRequest(request: PendingAccount) {
    if (!newPin.trim() || newPin.trim().length < 4) {
      toast.error('Set a PIN (at least 4 characters) for the new account')
      return
    }

    try {
      const { error: userError } = await supabase.from('users').insert([
        {
          full_name: request.full_name,
          email: request.email,
          role: request.requested_role,
          pin: newPin.trim(),
          is_active: true,
        },
      ])
      if (userError) throw userError

      const { error: updateError } = await supabase
        .from('pending_accounts')
        .update({ status: 'approved', reviewed_by: user?.id, reviewed_at: new Date().toISOString(), note: reviewNote || null })
        .eq('id', request.id)
      if (updateError) throw updateError

      toast.success(`Account created for ${request.full_name}`)
      setReviewingRequest(null)
      setReviewNote('')
      setNewPin('')
      fetchStaff()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to approve request'
      toast.error(message)
    }
  }

  async function handleRejectRequest(request: PendingAccount) {
    try {
      const { error } = await supabase
        .from('pending_accounts')
        .update({ status: 'rejected', reviewed_by: user?.id, reviewed_at: new Date().toISOString(), note: reviewNote || 'Rejected by owner' })
        .eq('id', request.id)
      if (error) throw error

      toast.success(`Request from ${request.full_name} rejected`)
      setReviewingRequest(null)
      setReviewNote('')
      fetchStaff()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reject request'
      toast.error(message)
    }
  }

  async function fetchStaff() {
    setLoading(true)
    try {
      const [{ data: staffData, error: staffError }, { data: pendingData, error: pendingError }, { data: devicesData, error: devicesError }] = await Promise.all([
        supabase.from('users').select('id, full_name, email, role, is_active, last_login, created_at').order('full_name'),
        supabase.from('pending_accounts').select('*').eq('status', 'pending').order('created_at'),
        supabase
          .from('cashier_device_approvals')
          .select('*')
          .in('status', ['pending', 'approved'])
          .order('created_at', { ascending: false }),
      ])

      if (staffError) throw staffError
      if (pendingError) console.error('Failed to load pending requests', pendingError)
      if (devicesError) console.error('Failed to load device approvals', devicesError)

      setStaff((staffData || []) as User[])
      setPendingRequests((pendingData || []) as PendingAccount[])
      
      // Fetch user data for devices and map them
      if (devicesData && devicesData.length > 0) {
        const userIdSet = new Set<string>()
        ;(devicesData as any[]).forEach(d => userIdSet.add(d.user_id))
        const userIds = Array.from(userIdSet)
        
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select('id, full_name, email')
          .in('id', userIds)
        
        if (!usersError && usersData) {
          const userMap = Object.fromEntries((usersData as any[]).map(u => [u.id, u]))
          const devices = (devicesData as any[]).map(device => ({
            ...device,
            user: userMap[device.user_id]
          })) as CashierDeviceApproval[]
          setPendingDevices(devices.filter(device => device.status === 'pending'))
          setActiveDevices(devices.filter(device => device.status === 'approved'))
        } else {
          const devices = (devicesData as any[]) as CashierDeviceApproval[]
          setPendingDevices(devices.filter(device => device.status === 'pending'))
          setActiveDevices(devices.filter(device => device.status === 'approved'))
        }
      } else {
        setPendingDevices([])
        setActiveDevices([])
      }
      
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load staff'
      setError(message)
      toast.error(`❌ ${message}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleApproveDevice(device: CashierDeviceApproval) {
    setApprovingDevice(true)
    try {
      const { error } = await supabase
        .from('cashier_device_approvals')
        .update({
          status: 'approved',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', device.id)

      if (error) throw error
      toast.success('Device approved permanently')
      setReviewingDevice(null)
      fetchStaff()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to approve device'
      toast.error(message)
    } finally {
      setApprovingDevice(false)
    }
  }

  async function handleRevokeDevice(device: CashierDeviceApproval) {
    setRevokingDevice(true)
    try {
      const { error } = await supabase
        .from('cashier_device_approvals')
        .update({
          status: 'revoked',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', device.id)

      if (error) throw error
      toast.success('Device access terminated')
      setReviewingDevice(null)
      fetchStaff()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to terminate device'
      toast.error(message)
    } finally {
      setRevokingDevice(false)
    }
  }

  async function handleRejectDevice(device: CashierDeviceApproval) {
    try {
      const { error } = await supabase
        .from('cashier_device_approvals')
        .update({
          status: 'rejected',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', device.id)

      if (error) throw error
      toast.success('Device approval rejected')
      setReviewingDevice(null)
      fetchStaff()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reject device'
      toast.error(message)
    }
  }

  const stats = useMemo(() => {
    return {
      total: staff.length,
      owners: staff.filter(item => item.role === 'owner').length,
      cashiers: staff.filter(item => item.role === 'cashier').length,
      active: staff.filter(item => item.is_active).length,
      inactive: staff.filter(item => !item.is_active).length,
    }
  }, [staff])

  const filtered = useMemo(
    () => staff.filter(member =>
      !search ||
      member.full_name.toLowerCase().includes(search.toLowerCase()) ||
      member.email?.toLowerCase().includes(search.toLowerCase()) ||
      member.role.toLowerCase().includes(search.toLowerCase())
    ),
    [staff, search]
  )

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner label="Loading staff..." /></div>

  return (
    <RoleGuard allowed={['owner']}>
      <div className="space-y-6">
        <PageHeader
          title="Staff"
          description="Manage your team and review access roles"
          action={
            <button onClick={openNewStaff} className="btn-primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Staff
            </button>
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Team members', value: stats.total.toString(), icon: Users, color: 'bg-slate-50 text-slate-900' },
            { label: 'Owners', value: stats.owners.toString(), icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-700' },
            { label: 'Cashiers', value: stats.cashiers.toString(), icon: Users, color: 'bg-blue-50 text-sky-700' },
            { label: 'Active', value: stats.active.toString(), icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-700' },
            { label: 'Inactive', value: stats.inactive.toString(), icon: Slash, color: 'bg-slate-100 text-slate-700' },
          ].map(item => (
            <div key={item.label} className="card p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
                  <p className="text-2xl font-bold text-slate-900 mt-2">{item.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${item.color}`}>
                  <item.icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                className="input pl-10"
                placeholder="Search staff by name, email, or role"
                value={search}
                onChange={e => setSearch(e.target.value)}
        />

        {pendingRequests.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{pendingRequests.length} pending account request{pendingRequests.length === 1 ? '' : 's'}</p>
                <p className="text-xs text-slate-500">Review and approve access for new staff</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPending(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" /> Review Requests
            </button>
          </div>
        )}

        {pendingDevices.length > 0 && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-red-600" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{pendingDevices.length} pending device approval{pendingDevices.length === 1 ? '' : 's'}</p>
                <p className="text-xs text-slate-500">Cashiers waiting to access from new devices</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDevices(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Smartphone className="w-4 h-4" /> Review Devices
            </button>
          </div>
        )}

        {activeDevices.length > 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{activeDevices.length} active device session{activeDevices.length === 1 ? '' : 's'}</p>
                <p className="text-xs text-slate-500">Terminate device access for current cashier sessions</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDevices(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Smartphone className="w-4 h-4" /> Manage Devices
            </button>
          </div>
        )}
            </div>
            <p className="text-sm text-slate-500">{filtered.length} of {staff.length} members</p>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="table-head">Name</th>
                <th className="table-head">Email</th>
                <th className="table-head">Role</th>
                <th className="table-head">Status</th>
                <th className="table-head">Last login</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">No matching staff found.</td>
                </tr>
              ) : (
                filtered.map(member => (
                  <tr key={member.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="table-cell font-medium text-slate-900">{member.full_name}</td>
                    <td className="table-cell text-slate-500">{member.email || '—'}</td>
                    <td className="table-cell capitalize">{member.role}</td>
                    <td className="table-cell">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${member.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {member.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="table-cell text-slate-500">{member.last_login ? formatDateTime(member.last_login) : '—'}</td>
                    <td className="table-cell text-right space-x-2">
                      <button onClick={() => openEditStaff(member)} className="text-slate-600 hover:text-brand-600" title="Edit staff"><Edit3 className="inline w-4 h-4" /></button>
                      <button onClick={() => toggleStaffStatus(member)} className="text-slate-600 hover:text-amber-600" title={member.is_active ? 'Deactivate' : 'Activate'}><Slash className="inline w-4 h-4" /></button>
                      <button onClick={() => handleDeleteStaff(member)} className="text-slate-600 hover:text-red-600" title="Delete staff"><Trash2 className="inline w-4 h-4" /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Modal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false)
            resetStaffForm()
          }}
          title={editingStaff ? 'Edit Staff' : 'Add Staff'}
          description="Create or update a staff account with a role and access status."
          footer={
            <div className="flex justify-end gap-3">
              <button onClick={() => {
                setModalOpen(false)
                resetStaffForm()
              }} className="btn-secondary">Cancel</button>
              <button onClick={handleSaveStaff} disabled={savingStaff} className="btn-primary inline-flex items-center gap-2">
                <Save className="w-4 h-4" /> {savingStaff ? 'Saving...' : editingStaff ? 'Update' : 'Save'}
              </button>
            </div>
          }
          size="md"
        >
          <div className="grid gap-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Full name</span>
              <input value={staffForm.full_name} onChange={e => setStaffForm({ ...staffForm, full_name: e.target.value })} className="input w-full" />
              {staffErrors.full_name && <p className="text-xs text-red-600">{staffErrors.full_name}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input value={staffForm.email} onChange={e => setStaffForm({ ...staffForm, email: e.target.value })} className="input w-full" />
              {staffErrors.email && <p className="text-xs text-red-600">{staffErrors.email}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Role</span>
              <select value={staffForm.role} onChange={e => setStaffForm({ ...staffForm, role: e.target.value as 'owner' | 'cashier' })} className="input w-full">
                <option value="cashier">Cashier</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">PIN</span>
              <input type="password" value={staffForm.pin} onChange={e => setStaffForm({ ...staffForm, pin: e.target.value })} className="input w-full" placeholder={editingStaff ? 'Leave blank to keep current PIN' : 'Enter a 4-digit PIN'} />
              {staffErrors.pin && <p className="text-xs text-red-600">{staffErrors.pin}</p>}
            </label>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={staffForm.is_active} onChange={e => setStaffForm({ ...staffForm, is_active: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              <span className="text-sm text-slate-700">Active account</span>
            </label>
          </div>
        </Modal>

        {showPending && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Pending Account Requests</h3>
                  <p className="text-sm text-slate-500">Review and approve cashier access requests</p>
                </div>
                <button onClick={() => { setShowPending(false); setReviewingRequest(null) }} className="rounded-lg p-2 hover:bg-slate-100">
                  <XCircle className="w-5 h-5 text-slate-600" />
                </button>
              </div>

              {pendingRequests.length === 0 ? (
                <div className="py-12 text-center text-slate-500">No pending requests</div>
              ) : (
                <div className="space-y-3">
                  {pendingRequests.map(request => (
                    <div key={request.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <p className="font-semibold text-slate-900">{request.full_name}</p>
                          <p className="text-sm text-slate-500">{request.email}</p>
                          <p className="text-xs text-slate-400 mt-1">Requested role: <span className="capitalize font-medium text-slate-600">{request.requested_role}</span></p>
                          <p className="text-xs text-slate-400">Submitted: {formatDateTime(request.created_at)}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          type="button"
                          onClick={() => setReviewingRequest(request)}
                          className="btn-primary inline-flex items-center gap-2 text-sm"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Review
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {reviewingRequest && (
          <Modal
            isOpen={!!reviewingRequest}
            onClose={() => { setReviewingRequest(null); setReviewNote(''); setNewPin('') }}
            title="Review Account Request"
            description={`Review request from ${reviewingRequest.full_name}`}
            footer={
              <div className="flex justify-end gap-3">
                <button onClick={() => { setReviewingRequest(null); setReviewNote(''); setNewPin('') }} className="btn-secondary">Cancel</button>
                <button onClick={() => handleRejectRequest(reviewingRequest)} className="btn-danger inline-flex items-center gap-2">
                  <XCircle className="w-4 h-4" /> Reject
                </button>
                <button onClick={() => handleApproveRequest(reviewingRequest)} className="btn-primary inline-flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Approve & Create Account
                </button>
              </div>
            }
            size="md"
          >
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4 space-y-2">
                <div>
                  <p className="text-xs text-slate-500">Name</p>
                  <p className="text-sm font-semibold text-slate-900">{reviewingRequest.full_name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Email</p>
                  <p className="text-sm font-semibold text-slate-900">{reviewingRequest.email}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Requested Role</p>
                  <p className="text-sm font-semibold text-slate-900 capitalize">{reviewingRequest.requested_role}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Submitted</p>
                  <p className="text-sm font-semibold text-slate-900">{formatDateTime(reviewingRequest.created_at)}</p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Set account PIN</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input w-full"
                  placeholder="Enter PIN (min 4 characters)"
                  value={newPin}
                  onChange={e => setNewPin(e.target.value)}
                />
                <p className="text-xs text-slate-500">This PIN will be needed by the staff member to log in.</p>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Note (optional)</span>
                <textarea
                  className="input h-20 w-full resize-none"
                  placeholder="Add a note for this decision"
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                />
              </label>
            </div>
          </Modal>
        )}

        {showDevices && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Pending Device Approvals</h3>
                  <p className="text-sm text-slate-500">Cashiers requesting access from new devices</p>
                </div>
                <button onClick={() => { setShowDevices(false); setReviewingDevice(null) }} className="rounded-lg p-2 hover:bg-slate-100">
                  <XCircle className="w-5 h-5 text-slate-600" />
                </button>
              </div>

              {pendingDevices.length === 0 && activeDevices.length === 0 ? (
                <div className="py-12 text-center text-slate-500">No device approvals or active sessions</div>
              ) : (
                <div className="space-y-6">
                  {pendingDevices.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-sm font-semibold text-slate-900">Pending requests</div>
                      {pendingDevices.map(device => (
                        <div key={device.id} className="rounded-xl border border-slate-200 p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <p className="font-semibold text-slate-900">{device.user?.full_name || 'Unknown'}</p>
                              <p className="text-sm text-slate-500">{device.user?.email || 'Unknown email'}</p>
                              <p className="text-xs text-slate-400 mt-1">Device: <span className="font-medium text-slate-600">{device.device_name || device.device_id}</span></p>
                               <p className="text-xs text-slate-400">Requested: {formatDateTime(device.created_at)}</p>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              type="button"
                              onClick={() => setReviewingDevice(device)}
                              className="btn-primary inline-flex items-center gap-2 text-sm"
                            >
                              <CheckCircle2 className="w-4 h-4" /> Review
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeDevices.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-sm font-semibold text-slate-900">Approved devices</div>
                      {activeDevices.map(device => (
                        <div key={device.id} className="rounded-xl border border-slate-200 p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <p className="font-semibold text-slate-900">{device.user?.full_name || 'Unknown'}</p>
                              <p className="text-sm text-slate-500">{device.user?.email || 'Unknown email'}</p>
                              <p className="text-xs text-slate-400 mt-1">Device: <span className="font-medium text-slate-600">{device.device_name || device.device_id}</span></p>
                              <p className="text-xs text-slate-400">Approved: {formatDateTime(device.reviewed_at || device.created_at)}</p>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              type="button"
                              onClick={() => setReviewingDevice(device)}
                              className="btn-secondary inline-flex items-center gap-2 text-sm"
                            >
                              <Clock className="w-4 h-4" /> View
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRevokeDevice(device)}
                              disabled={revokingDevice}
                              className="btn-danger inline-flex items-center gap-2 text-sm"
                            >
                              <XCircle className="w-4 h-4" /> Terminate
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {reviewingDevice && (
          <Modal
            isOpen={!!reviewingDevice}
            onClose={() => { setReviewingDevice(null) }}
            title="Review Device Approval"
            description={`Review device access request from ${reviewingDevice.user?.full_name || 'Unknown'}`}
            footer={
              <div className="flex justify-end gap-3">
                <button onClick={() => { setReviewingDevice(null) }} className="btn-secondary">Cancel</button>
                <button onClick={() => handleRejectDevice(reviewingDevice)} className="btn-danger inline-flex items-center gap-2">
                  <XCircle className="w-4 h-4" /> Reject
                </button>
                <button onClick={() => handleApproveDevice(reviewingDevice)} disabled={approvingDevice} className="btn-primary inline-flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> {approvingDevice ? 'Approving...' : 'Approve'}
                </button>
              </div>
            }
            size="md"
          >
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4 space-y-2">
                <div>
                  <p className="text-xs text-slate-500">Cashier</p>
                  <p className="text-sm font-semibold text-slate-900">{reviewingDevice.user?.full_name || 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Email</p>
                  <p className="text-sm font-semibold text-slate-900">{reviewingDevice.user?.email || 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Device</p>
                  <p className="text-sm font-semibold text-slate-900 break-all">{reviewingDevice.device_name || reviewingDevice.device_id}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Submitted</p>
                  <p className="text-sm font-semibold text-slate-900">{formatDateTime(reviewingDevice.created_at)}</p>
                </div>
              </div>

              {reviewingDevice.device_location && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
                  <p className="text-xs text-slate-500 mb-1">Login Location</p>
                  <p className="text-sm font-semibold text-blue-900">{reviewingDevice.device_location}</p>
                </div>
              )}

              {reviewingDevice.device_info && (
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-700 mb-2 uppercase">Device Details</p>
                  <div className="space-y-1 text-xs">
                    {typeof reviewingDevice.device_info === 'string' ? (
                      (() => {
                        try {
                          const info = JSON.parse(reviewingDevice.device_info)
                          return (
                            <>
                              {info.browser && <div className="text-slate-600"><span className="font-medium text-slate-700">Browser:</span> {info.browser}</div>}
                              {info.device_type && <div className="text-slate-600"><span className="font-medium text-slate-700">Device:</span> {info.device_type}</div>}
                              {info.platform && <div className="text-slate-600"><span className="font-medium text-slate-700">Platform:</span> {info.platform}</div>}
                              {info.screen_resolution && <div className="text-slate-600"><span className="font-medium text-slate-700">Screen:</span> {info.screen_resolution}</div>}
                              {info.language && <div className="text-slate-600"><span className="font-medium text-slate-700">Language:</span> {info.language}</div>}
                              {info.timezone && <div className="text-slate-600"><span className="font-medium text-slate-700">Timezone:</span> {info.timezone}</div>}
                            </>
                          )
                        } catch {
                          return <div className="text-slate-600">{reviewingDevice.device_info}</div>
                        }
                      })()
                    ) : (
                      <>
                        {reviewingDevice.device_info.browser && <div className="text-slate-600"><span className="font-medium text-slate-700">Browser:</span> {reviewingDevice.device_info.browser}</div>}
                        {reviewingDevice.device_info.device_type && <div className="text-slate-600"><span className="font-medium text-slate-700">Device:</span> {reviewingDevice.device_info.device_type}</div>}
                        {reviewingDevice.device_info.platform && <div className="text-slate-600"><span className="font-medium text-slate-700">Platform:</span> {reviewingDevice.device_info.platform}</div>}
                        {reviewingDevice.device_info.screen_resolution && <div className="text-slate-600"><span className="font-medium text-slate-700">Screen:</span> {reviewingDevice.device_info.screen_resolution}</div>}
                        {reviewingDevice.device_info.language && <div className="text-slate-600"><span className="font-medium text-slate-700">Language:</span> {reviewingDevice.device_info.language}</div>}
                        {reviewingDevice.device_info.timezone && <div className="text-slate-600"><span className="font-medium text-slate-700">Timezone:</span> {reviewingDevice.device_info.timezone}</div>}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Modal>
        )}
      </div>
    </RoleGuard>
  )
}

