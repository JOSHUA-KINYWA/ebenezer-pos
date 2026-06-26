'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { ShoppingBag, Loader2, Shield, BarChart2, Package, Wallet, TrendingUp } from 'lucide-react'

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    const session = getSession()
    if (session) {
      const supabase = createClient()
      supabase.from('users').select('id, full_name, email, role, is_active').eq('id', session.id).eq('is_active', true).maybeSingle().then(({ data }) => {
        if (data) {
          setUser(data as SessionUser)
          router.replace('/dashboard')
        } else {
          setLoading(false)
        }
      })
    } else {
      setLoading(false)
    }
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto mb-4" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto mb-4" />
          <p className="text-sm text-slate-500">Redirecting to dashboard...</p>
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
          <div className="mt-10 space-y-3">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <BarChart2 className="w-4 h-4 text-brand-400" />
              Real-time sales tracking & reports
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <Package className="w-4 h-4 text-brand-400" />
              Smart inventory management
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <Wallet className="w-4 h-4 text-brand-400" />
              Cash drawer & expense tracking
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <TrendingUp className="w-4 h-4 text-brand-400" />
              Analytics to grow your business
            </div>
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
              <h2 className="text-xl font-bold text-slate-900">Welcome to Ebenezar POS</h2>
              <p className="text-sm text-slate-500 mt-1">Sign in to access your dashboard</p>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => router.push('/login')}
                className="btn-primary w-full py-3 text-base"
              >
                Sign in to Dashboard
              </button>

              <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                <Shield className="w-4 h-4 text-slate-400" />
                <p className="text-xs text-slate-500">Secure role-based access for owners and cashiers</p>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            Contact your shop owner if you need access
          </p>
        </div>
      </div>
    </div>
  )
}
