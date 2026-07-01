'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { SessionUser, Sale, DailySalesSummary, User, Expense } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatDate } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import {
  TrendingUp, ShoppingCart, Package, Users, DollarSign, Activity,
  AlertTriangle, RefreshCw, Wallet, Plus, ArrowUpRight, ArrowDownRight,
  Coins, BarChart2, Receipt, FileText, CreditCard, TrendingDown,
  Settings, Zap, ClipboardList, Briefcase
} from 'lucide-react'

type DashboardRange = 'today' | '7d' | '30d'

interface DashboardStats {
  revenue: number
  transactions: number
  lowStockItems: number
  activeShifts: number
  totalStaff: number
  dailyData: DailySalesSummary[]
  drawerCash: number
  drawerCoin: number
  drawerTill: number
  topProducts: { name: string; qty: number; revenue: number }[]
  totalExpenses: number
  avgOrderValue: number
  paymentBreakdown: Record<string, number>
  recentSales: { id: string; total_amount: number; created_at: string; payment_type: string }[]
  recentExpenses: Expense[]
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<DashboardRange>('today')
  const { settings } = useShopSettings()
  const toast = useToast()
  const supabase = createClient()

  useEffect(() => {
    const session = getSession()
    setUser(session)
    if (session) fetchDashboardData()
  }, [range])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleDrawerUpdate = () => {
      fetchDashboardData()
    }
    window.addEventListener('drawer-update', handleDrawerUpdate)
    return () => window.removeEventListener('drawer-update', handleDrawerUpdate)
  }, [])

  async function fetchDashboardData() {
    try {
      setLoading(true)
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const since = range === 'today' ? today : new Date(Date.now() - (parseInt(range) * 24 * 60 * 60 * 1000)).toISOString()

      const { data: salesData } = await supabase
        .from('sales')
        .select('id, total_amount, payment_type, payment_method, created_at')
        .gte('created_at', since)
        .eq('is_voided', false)
        .order('created_at', { ascending: false })
        .limit(10)

      const { data: allSales } = await supabase
        .from('sales')
        .select('id, total_amount, payment_type, payment_method, sale_items(quantity, product_id, product_name, subtotal, unit_price)')
        .gte('created_at', since)
        .eq('is_voided', false)

      const revenue = (allSales || []).reduce((sum, s) => sum + Number(s.total_amount), 0)
      const transactions = allSales?.length || 0
      const avgOrderValue = transactions > 0 ? revenue / transactions : 0

      const paymentBreakdown = (allSales || []).reduce((acc, s) => {
        acc[s.payment_type] = (acc[s.payment_type] || 0) + Number(s.total_amount)
        return acc
      }, {} as Record<string, number>)

      const { data: productsData } = await supabase
        .from('products')
        .select('id, stock_qty, stock_alert')
        .eq('is_active', true)

      const lowStockItems = (productsData || []).filter(p => p.stock_qty <= p.stock_alert && p.stock_qty > 0).length

      const { data: staffData } = await supabase
        .from('users')
        .select('id')
        .eq('is_active', true)

      const { data: openShifts } = await supabase
        .from('shifts')
        .select('id')
        .eq('status', 'open')

      const dailyLimit = range === 'today' ? 1 : range === '7d' ? 7 : 30
      const { data: dailyData } = await supabase
        .from('daily_sales_summary')
        .select('*')
        .gte('sale_date', since.split('T')[0])
        .order('sale_date', { ascending: false })
        .limit(dailyLimit)

      const { data: drawerData } = await supabase
      .from('drawer_balances')
      .select('cash, coin, till')
      .eq('date', today)
      .is('shift_id', null)
      .maybeSingle()

      const { data: expenseData } = await supabase
        .from('expenses')
        .select('*')
        .gte('expense_date', since.split('T')[0])
        .lte('expense_date', today)

      const totalExpenses = (expenseData || []).reduce((sum, e) => sum + Number(e.amount), 0)

      const productMap = new Map<string, { name: string; qty: number; revenue: number }>()
      ;(allSales || []).forEach((sale: any) => {
        ;(sale.sale_items || []).forEach((item: any) => {
          const existing = productMap.get(item.product_id) || { name: item.product_name || item.product_id, qty: 0, revenue: 0 }
          existing.qty += item.quantity
          existing.revenue += Number(item.subtotal || 0)
          productMap.set(item.product_id, existing)
        })
      })
      const topProducts = Array.from(productMap.values() as Iterable<{ name: string; qty: number; revenue: number }>)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)

      setStats({
        revenue,
        transactions,
        lowStockItems,
        activeShifts: openShifts?.length || 0,
        totalStaff: staffData?.length || 0,
        dailyData: dailyData || [],
        drawerCash: drawerData?.cash || 0,
        drawerCoin: drawerData?.coin || 0,
        drawerTill: drawerData?.till || 0,
        topProducts,
        totalExpenses,
        avgOrderValue,
        paymentBreakdown,
        recentSales: (salesData || []).slice(0, 10),
        recentExpenses: (expenseData || []).slice(0, 10),
      })
    } catch (error) {
      console.error('Error fetching dashboard data:', error instanceof Error ? error.message : String(error))
      toast.error('Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }

  const drawerTotal = stats ? stats.drawerCash + stats.drawerCoin + stats.drawerTill : 0
  const netProfit = stats ? stats.revenue - stats.totalExpenses : 0

  const kpiCards = [
    { label: 'Revenue', value: formatMoney(stats?.revenue || 0, settings.currency), icon: DollarSign, color: 'bg-emerald-500', change: stats ? `${formatMoney(netProfit, settings.currency)} profit` : '' },
    { label: 'Transactions', value: (stats?.transactions || 0).toLocaleString(), icon: ShoppingCart, color: 'bg-blue-500', change: stats?.transactions ? `Avg ${formatMoney(stats.avgOrderValue, settings.currency)}` : '' },
    { label: 'Expenses', value: formatMoney(stats?.totalExpenses || 0, settings.currency), icon: TrendingDown, color: 'bg-red-500', change: stats?.revenue ? `${((stats.totalExpenses / stats.revenue) * 100).toFixed(1)}% of revenue` : '' },
    { label: 'Low Stock', value: (stats?.lowStockItems || 0).toString(), icon: AlertTriangle, color: 'bg-amber-500', change: stats?.lowStockItems ? 'Needs attention' : 'All good' },
    { label: 'Active Staff', value: (stats?.totalStaff || 0).toString(), icon: Users, color: 'bg-brand-600', change: stats?.totalStaff ? `${stats.totalStaff} registered` : 'No staff' },
    { label: 'Drawer Total', value: formatMoney(drawerTotal, settings.currency), icon: Wallet, color: 'bg-violet-500', change: 'Cash + Coin + Till' },
  ]

  const rangeLabels: Record<DashboardRange, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' }

  const quickActions = [
    { label: 'New Sale', icon: ShoppingCart, href: '/dashboard/sell', color: 'bg-emerald-500' },
    { label: 'Stock', icon: Package, href: '/dashboard/stock', color: 'bg-blue-500' },
    { label: 'Expenses', icon: TrendingDown, href: '/dashboard/expenses', color: 'bg-red-500' },
    { label: 'Reports', icon: BarChart2, href: '/dashboard/reports', color: 'bg-amber-500' },
    { label: 'Drawer', icon: Wallet, href: '/dashboard/drawer', color: 'bg-violet-500' },
    { label: 'Staff', icon: Users, href: '/dashboard/staff', color: 'bg-indigo-500' },
    { label: 'Settings', icon: Settings, href: '/dashboard/settings', color: 'bg-slate-600' },
  ]

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner label="Loading dashboard..." /></div>

  const hasData = stats && (stats.transactions > 0 || stats.dailyData.length > 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`Welcome back, ${user?.full_name}`} action={
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
            {(['today', '7d', '30d'] as DashboardRange[]).map(r => (
              <button key={r} onClick={() => setRange(r)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${range === r ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
                {rangeLabels[r]}
              </button>
            ))}
          </div>
          <button onClick={fetchDashboardData} className="btn-secondary"><RefreshCw className="w-4 h-4" /> Refresh</button>
        </div>
      } />

      {!hasData && !loading && (
        <div className="card p-12 text-center"><EmptyState icon={Activity} title="No data yet" description="Start making sales to see your dashboard come alive." /></div>
      )}

      {hasData && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {quickActions.map(({ label, icon: Icon, href, color }) => (
              <button
                key={label}
                onClick={() => router.push(href)}
                className="card p-3 text-center hover:shadow-md hover:scale-105 transition-all group"
              >
                <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <p className="text-xs font-semibold text-slate-900">{label}</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {kpiCards.map(({ label, value, icon: Icon, color, change }) => (
              <div key={label} className="card p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl ${color.replace('bg-', 'bg-').replace('-500', '-50')} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${color.replace('bg-', 'text-')}`} />
                  </div>
                </div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
                {change && <p className="text-xs text-slate-400 mt-1">{change}</p>}
              </div>
            ))}
          </div>

          {stats && stats.topProducts && stats.topProducts.length > 0 && (
            <div className="card p-6">
              <h3 className="text-base font-bold text-slate-900 mb-4">Top Selling Products</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500">
                      <th className="py-2 text-left">Product</th>
                      <th className="py-2 text-right">Qty Sold</th>
                      <th className="py-2 text-right">Revenue</th>
                      <th className="py-2 text-right">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topProducts.slice(0, 8).map((product, idx) => (
                      <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2 font-medium text-slate-900 truncate">{product.name}</td>
                        <td className="py-2 text-right text-slate-600">{product.qty.toFixed(1)}</td>
                        <td className="py-2 text-right font-semibold text-slate-900">{formatMoney(product.revenue, settings.currency)}</td>
                        <td className="py-2 text-right text-slate-500">{stats.revenue > 0 ? ((product.revenue / stats.revenue) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {stats && Object.keys(stats.paymentBreakdown).length > 0 && (
            <div className="card p-6">
              <h3 className="text-base font-bold text-slate-900 mb-4">Payment Breakdown</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {Object.entries(stats.paymentBreakdown).map(([method, amount]) => (
                  <div key={method} className="bg-slate-50 rounded-xl p-4">
                    <p className="text-xs text-slate-500 mb-1 capitalize">{method}</p>
                    <p className="text-lg font-bold text-slate-900">{formatMoney(amount, settings.currency)}</p>
                    <p className="text-xs text-slate-400">{stats.revenue > 0 ? ((amount / stats.revenue) * 100).toFixed(1) : 0}%</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
            <div className="space-y-6">
              {stats?.recentSales && stats.recentSales.length > 0 && (
                <div className="card p-6">
                  <h3 className="text-base font-bold text-slate-900 mb-4">Recent Sales</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500 text-sm">
                          <th className="py-2 text-left">ID</th>
                          <th className="py-2 text-left">Amount</th>
                          <th className="py-2 text-left">Payment</th>
                          <th className="py-2 text-left">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.recentSales.map(sale => (
                          <tr key={sale.id} className="border-b border-slate-50">
                            <td className="py-2 text-sm text-slate-900 font-mono">#{sale.id.slice(0, 8)}</td>
                            <td className="py-2 text-sm font-semibold text-slate-900">{formatMoney(Number(sale.total_amount), settings.currency)}</td>
                            <td className="py-2 text-sm text-slate-500 capitalize">{sale.payment_type}</td>
                            <td className="py-2 text-sm text-slate-400">{formatDate(sale.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {stats?.recentExpenses && stats.recentExpenses.length > 0 && (
                <div className="card p-6">
                  <h3 className="text-base font-bold text-slate-900 mb-4">Recent Expenses</h3>
                  <div className="space-y-3">
                    {stats.recentExpenses.slice(0, 5).map(expense => (
                      <div key={expense.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{expense.item_name}</p>
                          <p className="text-xs text-slate-400">{formatDate(expense.expense_date)} • {expense.category || expense.payment_method}</p>
                        </div>
                        <span className="text-sm font-semibold text-red-600">-{formatMoney(Number(expense.amount), settings.currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-slate-900">Drawer Balance</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-slate-600">Cash</span>
                    <span className="font-bold text-slate-900">{formatMoney(stats?.drawerCash || 0, settings.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-slate-600">Coin</span>
                    <span className="font-bold text-slate-900">{formatMoney(stats?.drawerCoin || 0, settings.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-slate-600">Till</span>
                    <span className="font-bold text-slate-900">{formatMoney(stats?.drawerTill || 0, settings.currency)}</span>
                  </div>
                  <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">Total</span>
                    <span className="text-lg font-bold text-brand-600">{formatMoney(drawerTotal, settings.currency)}</span>
                  </div>
                </div>
              </div>

              {stats?.lowStockItems > 0 && (
                <div className="card p-6 border-red-100 bg-red-50/50">
                  <div className="flex items-center gap-3 mb-3">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    <h3 className="text-base font-bold text-slate-900">Stock Alert</h3>
                  </div>
                  <p className="text-sm text-slate-600 mb-3"><span className="font-bold text-red-600">{stats.lowStockItems}</span> products below reorder level</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
