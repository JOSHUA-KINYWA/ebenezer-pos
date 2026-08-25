'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { clearSession, getSession } from '@/lib/auth'
import { getDeviceId, getDeviceName } from '@/lib/auth'
import { LoadingSpinner } from './LoadingSpinner'
import { Smartphone, Clock, AlertTriangle } from 'lucide-react'

interface DeviceApprovalGuardProps {
  children: React.ReactNode
}

export function DeviceApprovalGuard({ children }: DeviceApprovalGuardProps) {
  const router = useRouter()
  const supabase = createClient()
  const [approved, setApproved] = useState<boolean | null>(null)
  const [deviceName, setDeviceName] = useState<string>('')
  const user = getSession()

  useEffect(() => {
    if (!user) {
      router.push('/login')
      return
    }

    // Only enforce device approval for cashiers
    if (user.role !== 'cashier') {
      setApproved(true)
      return
    }

    checkDeviceApproval()

    const interval = window.setInterval(() => {
      if (user?.role === 'cashier') {
        checkDeviceApproval()
      }
    }, 60_000)

    return () => window.clearInterval(interval)
  }, [user])

  async function checkDeviceApproval() {
    try {
      const deviceId = getDeviceId()
      const { data, error } = await supabase
        .from('cashier_device_approvals')
        .select('status, expires_at')
        .eq('user_id', user?.id)
        .eq('device_id', deviceId)
        .maybeSingle()

      if (error) throw error

      if (data?.status === 'approved') {
        if (data.expires_at) {
          const expiresAt = new Date(data.expires_at)
          if (new Date() > expiresAt) {
            setApproved(false)
            setDeviceName(getDeviceName())
          } else {
            setApproved(true)
          }
        } else {
          setApproved(true)
        }
      } else if (data?.status === 'revoked') {
        clearSession()
        router.replace('/login')
        return
      } else {
        setApproved(false)
        setDeviceName(getDeviceName())
      }
    } catch (error) {
      console.error('Failed to check device approval:', error)
      setApproved(false)
      setDeviceName(getDeviceName())
    }
  }

  if (approved === null) {
    return <div className="flex items-center justify-center py-20"><LoadingSpinner label="Checking device approval..." /></div>
  }

  if (!approved) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
        <div className="card w-full max-w-md p-8 text-center">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Device Approval Required</h1>
          <p className="text-slate-600 mb-4">
            This device hasn&apos;t been approved yet. Your manager needs to review and approve your access request.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-left">
            <p className="text-xs text-slate-500 mb-1">Device Information:</p>
            <p className="text-sm font-mono text-slate-900 break-all">{deviceName}</p>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 mb-6">
            <Clock className="w-4 h-4" />
            Please wait while the manager reviews your request
          </div>
          <button
            onClick={() => checkDeviceApproval()}
            className="btn-primary w-full inline-flex items-center justify-center gap-2"
          >
            <AlertTriangle className="w-4 h-4" />
            Retry
          </button>
          <p className="text-xs text-slate-500 mt-4">
            If you believe this is an error, contact your manager.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
