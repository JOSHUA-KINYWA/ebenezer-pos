'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { getDeviceId, getDeviceName, setSession, toSessionUser } from '@/lib/auth'
import { hashPin } from '@/lib/pin-hash'
import { ShoppingBag, Loader2, Shield } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const trimmedPin = pin.trim()
    const pinHash = await hashPin(trimmedPin)
    const { data, error: dbError } = await supabase
      .from('users')
      .select('id, full_name, email, role, pin, is_active')
      .eq('email', email.trim().toLowerCase())
      .eq('is_active', true)
      .or(`pin.eq.${pinHash},pin.eq.${trimmedPin}`)
      .maybeSingle()

    if (dbError || !data) {
      setError('Incorrect email or PIN. Please try again.')
      setLoading(false)
      return
    }

    if (data.pin !== pinHash) {
      const { error: updateError } = await supabase
        .from('users')
        .update({ pin: pinHash })
        .eq('id', data.id)
      if (updateError) {
        console.error('Failed to migrate PIN to hash', updateError)
      }
    }

    if (data.role === 'cashier') {
      const deviceId = getDeviceId()
      const now = new Date().toISOString()
      const { data: approval } = await supabase
        .from('cashier_device_approvals')
        .select('id, expires_at')
        .eq('user_id', data.id)
        .eq('device_id', deviceId)
        .eq('status', 'approved')
        .gt('expires_at', now)
        .maybeSingle()

      if (!approval) {
        const deviceName = getDeviceName()
        await supabase
          .from('cashier_device_approvals')
          .upsert({
            user_id: data.id,
            device_id: deviceId,
            device_name: deviceName,
            status: 'pending',
            requested_duration_hours: 12,
            updated_at: now,
          }, { onConflict: 'user_id,device_id' })

        try {
          const { data: ownerEmails } = await supabase
            .from('users')
            .select('email')
            .eq('role', 'owner')
            .eq('is_active', true)

          const emails = (ownerEmails || []).map((o: { email?: string }) => o.email).filter((email: string | undefined): email is string => Boolean(email))

          if (emails.length > 0) {
            await fetch('/api/device-approval/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                cashierName: data.full_name,
                cashierEmail: data.email,
                deviceName,
                ownerEmails: emails,
              }),
            })
          }
        } catch {
          // notification failure shouldn't block login
        }

        setError('This cashier device is waiting for owner approval. Ask the owner to approve it from Staff.')
        setLoading(false)
        return
      }
    }

    const { error: loginUpdateError } = await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', data.id)
    if (loginUpdateError) {
      console.error('Failed to update last login', loginUpdateError)
    }

    setSession(toSessionUser(data))
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-600/20 to-transparent" />
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mb-8 shadow-xl shadow-brand-600/30">
            <ShoppingBag className="w-7 h-7" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4">Ebenezar POS</h1>
          <p className="text-lg text-slate-300 max-w-md leading-relaxed">
            Fast, reliable point of sale for your shop. Track sales, manage stock, and grow your business.
          </p>
          <div className="mt-10 flex items-center gap-3 text-sm text-slate-400">
            <Shield className="w-4 h-4 text-brand-400" />
            Secure staff login with role-based access
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-slate-50">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <ShoppingBag className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Ebenezar POS</h1>
          </div>

          <div className="card p-8">
            <div className="mb-8">
              <h2 className="text-xl font-bold text-slate-900">Welcome back</h2>
              <p className="text-sm text-slate-500 mt-1">Sign in with your staff credentials</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="label">Email address</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@shop.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="label">PIN</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Enter your PIN"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  required
                  maxLength={8}
                  inputMode="numeric"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-3">
                  {error}
                </div>
              )}

              <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            Contact your shop owner if you need access
          </p>
          <p className="text-center text-xs mt-2">
            <Link href="/request-account" className="text-brand-600 hover:text-brand-700 font-medium">
              Request an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
