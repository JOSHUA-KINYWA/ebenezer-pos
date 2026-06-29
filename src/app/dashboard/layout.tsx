'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  ShoppingBag, ShoppingCart, BarChart2, Package,
  Users, Settings, LogOut, Menu, X, Clock, Wallet, DollarSign, Box, Tag, Bell
} from 'lucide-react'
import { SessionUser } from '@/types'
import { clearSession, getSession, refreshSession } from '@/lib/auth'
import { canAccessRoute } from '@/lib/permissions'
import { createClient } from '@/lib/supabase'
import { useShopSettings } from '@/hooks/useShopSettings'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { formatMoney } from '@/lib/format'

const nav = [
  { href: '/dashboard', icon: ShoppingBag, label: 'Dashboard', roles: ['owner', 'cashier'] },
  { href: '/dashboard/sell', icon: ShoppingCart, label: 'Sell', roles: ['owner', 'cashier'] },
  { href: '/dashboard/reports', icon: BarChart2, label: 'Reports', roles: ['owner', 'cashier'] },
  { href: '/dashboard/products', icon: Box, label: 'Products', roles: ['owner'] },
  { href: '/dashboard/stock', icon: Package, label: 'Stock', roles: ['owner', 'cashier'] },
  { href: '/dashboard/drawer', icon: Wallet, label: 'Drawer', roles: ['owner', 'cashier'] },
  { href: '/dashboard/expenses', icon: Package, label: 'Expenses', roles: ['owner'] },
  { href: '/dashboard/staff', icon: Users, label: 'Staff', roles: ['owner'] },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings', roles: ['owner'] },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(true)
  const [drawerCash, setDrawerCash] = useState(0)
  const [drawerCoin, setDrawerCoin] = useState(0)
  const [drawerTill, setDrawerTill] = useState(0)
  const [drawerLoaded, setDrawerLoaded] = useState(false)
  const [cartCount, setCartCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const supabase = createClient()
  const { settings } = useShopSettings()

  useEffect(() => {
    async function validateSession() {
      const session = getSession()
      if (!session) {
        router.push('/login')
        return
      }

      const supabase = createClient()
      const { data } = await supabase
        .from('users')
        .select('id, full_name, email, role, is_active')
        .eq('id', session.id)
        .eq('is_active', true)
        .maybeSingle()

      if (!data) {
        clearSession()
        router.push('/login')
        return
      }

      setUser(data as SessionUser)

      if (!canAccessRoute(pathname, data.role)) {
        setChecking(false)
        router.replace('/dashboard/sell')
        return
      }

      refreshSession()
      setChecking(false)
    }

    validateSession()
  }, [router, pathname])

  function logout() {
    clearSession()
    router.push('/login')
  }

  async function fetchDrawer() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('drawer_balances')
      .select('cash, coin, till')
      .eq('date', today)
      .is('shift_id', null)
      .maybeSingle()
    if (data) {
      setDrawerCash(data.cash || 0)
      setDrawerCoin(data.coin || 0)
      setDrawerTill(data.till || 0)
    }
    setDrawerLoaded(true)
  }

  async function fetchPendingCount() {
    if (!user || user.role !== 'owner') return
    const { count } = await supabase
      .from('pending_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
    if (typeof count === 'number') {
      setPendingCount(count)
    }
  }

  useEffect(() => {
    if (user) {
      fetchDrawer()
      fetchPendingCount()
      const interval = window.setInterval(fetchDrawer, 15000)
      return () => window.clearInterval(interval)
    }
  }, [user, supabase])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncCartCount = () => {
      try {
        const stored = window.localStorage.getItem('ebenezar-pos-cart')
        if (!stored) {
          setCartCount(0)
          return
        }

        const parsed = JSON.parse(stored) as Array<{ quantity?: number }>
        const count = Array.isArray(parsed)
          ? parsed.reduce((sum, item) => sum + (item.quantity || 0), 0)
          : 0
        setCartCount(count)
      } catch {
        setCartCount(0)
      }
    }

    syncCartCount()
    window.addEventListener('ebenezar-pos-cart-updated', syncCartCount as EventListener)

    return () => {
      window.removeEventListener('ebenezar-pos-cart-updated', syncCartCount as EventListener)
    }
  }, [])

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    const updateActivity = () => {
      refreshSession()
      if (!getSession()) {
        logout()
      }
    }

    events.forEach(eventName => window.addEventListener(eventName, updateActivity))

    const checkInterval = window.setInterval(() => {
      if (!getSession()) {
        logout()
      }
    }, 60_000)

    return () => {
      events.forEach(eventName => window.removeEventListener(eventName, updateActivity))
      window.clearInterval(checkInterval)
    }
  }, [])

  if (checking || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <LoadingSpinner label="Loading workspace..." />
      </div>
    )
  }

  const visibleNav = nav.filter(item => item.roles.includes(user.role))

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {open && (
        <div className="fixed inset-0 bg-slate-900/40 z-20 lg:hidden backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-30 w-72 bg-slate-900 text-white
        flex flex-col transition-transform duration-200 shadow-xl lg:shadow-none
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex items-center gap-3 px-6 py-6 border-b border-white/10">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-600/30">
            <ShoppingBag className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white text-sm truncate">{settings.shop_name}</p>
            <p className="text-xs text-slate-400 capitalize">{user.role} · POS</p>
          </div>
          <button onClick={() => setOpen(false)} className="ml-auto lg:hidden p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-5 space-y-1 overflow-y-auto">
          {visibleNav.map(({ href, icon: Icon, label }) => {
            const active = pathname.startsWith(href)
            const isCartLink = href === '/dashboard/sell'
            const badgeCount = isCartLink && cartCount > 0 ? cartCount : 0

            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                  active
                    ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1">{label}</span>
                {badgeCount > 0 && (
                  <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-slate-900">
                    {badgeCount}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="px-4 py-5 border-t border-white/10">
          <div className="flex items-center gap-3 px-3 py-3 mb-2 rounded-xl bg-white/5">
            <div className="w-9 h-9 bg-brand-600/20 rounded-full flex items-center justify-center text-brand-400 font-bold text-sm">
              {user.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user.full_name}</p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 mb-2">
            <Clock className="w-3.5 h-3.5" />
            {new Date().toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-sm font-semibold text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="lg:hidden flex items-center gap-3 px-4 py-3.5 bg-white border-b border-slate-200 shadow-sm">
          <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-slate-100">
            <Menu className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <span className="font-bold text-slate-900 block text-sm">{settings.shop_name}</span>
            <span className="text-xs text-slate-500 capitalize">{user.role}</span>
          </div>
          <Link href="/dashboard/sell" className="relative rounded-lg p-2 hover:bg-slate-100">
            <ShoppingCart className="w-5 h-5 text-slate-600" />
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>
          {user.role === 'owner' && (
            <Link href="/dashboard/staff" className="relative rounded-lg p-2 hover:bg-slate-100">
              <Bell className="w-5 h-5 text-slate-600" />
              {pendingCount > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </Link>
          )}
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  )
}
