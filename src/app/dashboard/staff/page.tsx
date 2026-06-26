'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { RoleGuard } from '@/components/RoleGuard'
import { SessionUser, User } from '@/types'
import { getSession } from '@/lib/auth'
import { formatDate } from '@/lib/format'
import { useToast } from '@/context/ToastContext'
import { Search, Users, CheckCircle2, Slash } from 'lucide-react'

export default function StaffPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [staff, setStaff] = useState<User[]>([])
  const [search, setSearch] = useState('')
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

  async function fetchStaff() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, role, is_active, last_login, created_at')
        .order('full_name')

      if (error) throw error

      setStaff((data || []) as User[])
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load staff'
      setError(message)
      toast.error(`❌ ${message}`)
    } finally {
      setLoading(false)
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
        <PageHeader title="Staff" description="Manage your team and review access roles" />

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
                    <td className="table-cell text-slate-500">{member.last_login ? formatDate(member.last_login) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </RoleGuard>
  )
}
