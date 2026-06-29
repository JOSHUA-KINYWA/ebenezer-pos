'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { ShoppingBag, Loader2, CheckCircle2 } from 'lucide-react'

export default function RequestAccountPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('cashier')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const trimmedEmail = email.trim().toLowerCase()

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', trimmedEmail)
      .maybeSingle()

    if (existing) {
      setError('This email is already registered. Contact the owner for access.')
      setLoading(false)
      return
    }

    const { error: insertError } = await supabase
      .from('pending_accounts')
      .insert([{
        full_name: fullName.trim(),
        email: trimmedEmail,
        requested_role: role,
        status: 'pending',
      }])

    if (insertError) {
      setError('Unable to submit request. Please try again.')
      console.error(insertError)
    } else {
      setSuccess(true)
    }

    setLoading(false)
  }

  if (success) {
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
              Fast, reliable point of sale for your shop.
            </p>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12 bg-slate-50">
          <div className="w-full max-w-md">
            <div className="card p-8 text-center">
              <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Request Submitted</h2>
              <p className="text-sm text-slate-500 mb-6">
                Your account request has been sent to the owner for approval. You will be notified once it is approved.
              </p>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="btn-primary w-full py-3"
              >
                Back to Login
              </button>
            </div>
          </div>
        </div>
      </div>
    )
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
              <h2 className="text-xl font-bold text-slate-900">Request Account Access</h2>
              <p className="text-sm text-slate-500 mt-1">Submit your details for owner approval</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="label">Full name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Your full name"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Email address</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="label">Requested role</label>
                <select
                  className="input"
                  value={role}
                  onChange={e => setRole(e.target.value)}
                >
                  <option value="cashier">Cashier</option>
                  <option value="owner">Owner</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">Owner requests require extra verification</p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-3">
                  {error}
                </div>
              )}

              <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>

            <p className="text-center text-xs text-slate-400 mt-6">
              Already have an account? <Link href="/login" className="text-brand-600 hover:text-brand-700">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
