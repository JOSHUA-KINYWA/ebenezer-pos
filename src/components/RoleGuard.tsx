'use client'

import { getSession } from '@/lib/auth'
import { ShieldAlert } from 'lucide-react'
import { Role } from '@/types'

interface RoleGuardProps {
  allowed: Role[]
  children: React.ReactNode
}

export function RoleGuard({ allowed, children }: RoleGuardProps) {
  const user = getSession()

  if (!user || !allowed.includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
          <ShieldAlert className="w-7 h-7 text-amber-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Access restricted</h2>
        <p className="text-sm text-slate-500">Only owners can access this section.</p>
      </div>
    )
  }

  return <>{children}</>
}
