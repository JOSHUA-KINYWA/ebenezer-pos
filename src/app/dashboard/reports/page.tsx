'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { DailySalesSummary, ProductSalesSummary, Sale, SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatDateTime } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { canVoidSales, canEditSales } from '@/lib/permissions'
import { Modal } from '@/components/Modal'
import { RoleGuard } from '@/components/RoleGuard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import {
  TrendingUp, ShoppingBag, Banknote, Download,
  RefreshCw, FileText, Ban, CreditCard, Percent, User as UserIcon, Calendar
} from 'lucide-react'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'

type Range = '7' | '30' | '90' | 'all'
type Tab = 'overview' | 'top_products' | 'transactions'

export default function ReportsPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('30')
  const [tab, setTab] = useState<Tab>('overview')
  const [filterCashier, setFilterCashier] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')
  const [daily, setDaily] = useState<DailySalesSummary[]>([])
  const [products, setProducts] = useState<ProductSalesSummary[]>([])
  const [transactions, setTransactions] = useState<Sale[]>([])
  const [cashiers, setCashiers] = useState<SessionUser[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [confirm, setConfirm] = useState<{ title: string; description: string; onConfirm: () => void; cancelLabel?: string; confirmLabel?: string; tone?: 'default' | 'danger' } | null>(null)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const { settings } = useShopSettings()
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

  async function fetchAll() {
    setLoading(true)
    try {
      const since = range === 'all' ? null : subDays(new Date(), parseInt(range)).toISOString()

      let salesQuery = supabase
        .from('sales')
        .select('*, sale_items(*)')
        .order('created_at', { ascending: false })
        .limit(500)

      if (since) salesQuery = salesQuery.gte('created_at', since)
      if (filterCashier !== 'all') salesQuery = salesQuery.eq('user_id', filterCashier)
      if (filterPayment !== 'all') salesQuery = salesQuery.eq('payment_type', filterPayment)
      if (selectedDate) {
        const dayStart = startOfDay(new Date(selectedDate)).toISOString()
        const dayEnd = endOfDay(new Date(selectedDate)).toISOString()
        salesQuery = salesQuery.gte('created_at', dayStart).lte('created_at', dayEnd)
      }

      const fromDate = since ? since.split('T')[0] : '2000-01-01'
      const todayDate = new Date().toISOString().split('T')[0]

      const [{ data: d, error: dailyError }, { data: p, error: productError }, { data: txns, error: txnError }] = await Promise.all([
        supabase.from('daily_sales_summary').select('*').gte('sale_date', fromDate).lte('sale_date', todayDate).order('sale_date', { ascending: false }).limit(range === 'all' ? 365 : parseInt(range)),
        supabase.from('product_sales_summary').select('*').limit(50),
        salesQuery,
      ])

      if (dailyError) throw new Error(`Failed to load daily summary: ${dailyError.message}`)
      if (productError) throw new Error(`Failed to load product summary: ${productError.message}`)
      if (txnError) throw txnError

      const { data: cashierData, error: cashierErr } = await supabase.from('users').select('id, full_name').eq('is_active', true).order('full_name')
      if (cashierErr) throw cashierErr

      setDaily(d || [])
      setProducts(p || [])
      setTransactions((txns ?? []) as Sale[])
      setCashiers((cashierData || []) as SessionUser[])
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load reports'
      console.error('Reports fetchAll error:', err)
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [range, filterCashier, filterPayment, selectedDate])

  async function cancelSale(sale: Sale) {
    if (!canVoidSales(user?.role)) return
    if (sale.is_voided) {
      toast.info('This sale is already cancelled.')
      return
    }
    setConfirm({
      title: 'Cancel sale',
      description: `Cancel receipt ${sale.receipt_no}? Stock will be restored.`,
      tone: 'danger',
      confirmLabel: 'Cancel sale',
      onConfirm: async () => {
        setConfirm(null)
        try {
          const today = new Date().toISOString().split('T')[0]
          if (sale.sale_items) {
            await Promise.all(
              (sale.sale_items || [])
                .filter((item): item is NonNullable<Sale['sale_items']>[0] & { product_id: string } => !!item.product_id)
                .map(async item => {
                  const { data: product, error: productError } = await supabase.from('products').select('stock_qty').eq('id', item.product_id).single()
                  if (productError || !product) throw new Error(`Unable to restore stock for ${item.product_name || item.product_id}`)

                  const nextStock = Number(product.stock_qty) + Number(item.quantity)
                  const { error: updateError } = await supabase.from('products').update({ stock_qty: nextStock }).eq('id', item.product_id)
                  if (updateError) throw updateError

                  const { error: logError } = await supabase.from('stock_log').insert({
                    product_id: item.product_id,
                    user_id: user?.id ?? null,
                    change_qty: Number(item.quantity),
                    reason: 'adjustment',
                    note: `Cancel sale ${sale.receipt_no}`,
                  })
                  if (logError) throw logError
                })
            )
          }

          const { data: existing } = await supabase
            .from('drawer_balances')
            .select('id, cash, coin, till')
            .eq('date', today)
            .is('shift_id', sale.shift_id || null)
            .maybeSingle()
          if (existing) {
            const nextCash = Number(existing.cash || 0) - (sale.payment_method === 'cash' ? sale.total_amount : 0)
            const nextCoin = Number(existing.coin || 0) - (sale.payment_method === 'coin' ? sale.total_amount : 0)
            const nextTill = Number(existing.till || 0) - (sale.payment_method === 'till' ? sale.total_amount : 0)
            const { error: drawerError } = await supabase
              .from('drawer_balances')
              .update({ cash: nextCash, coin: nextCoin, till: nextTill })
              .eq('id', existing.id)
            if (drawerError) throw drawerError
          } else {
            const insertData: any = { date: today, shift_id: sale.shift_id || null }
            if (sale.payment_method === 'cash') insertData.cash = -Number(sale.total_amount)
            else if (sale.payment_method === 'coin') insertData.coin = -Number(sale.total_amount)
            else insertData.till = -Number(sale.total_amount)
            const { error: drawerError } = await supabase.from('drawer_balances').insert(insertData)
            if (drawerError) throw drawerError
          }

          const { error: saleError } = await supabase.from('sales').update({ is_voided: true, voided_by: user?.id, voided_at: new Date().toISOString() }).eq('id', sale.id)
          if (saleError) throw saleError

          toast.success('Sale cancelled')
          fetchAll()
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to cancel sale'
          toast.error(message)
        }
      },
    })
  }

  async function updateSaleNote(saleId: string, note: string) {
    if (!canEditSales(user?.role)) return
    try {
      const { error } = await supabase.from('sales').update({ note }).eq('id', saleId)
      if (error) throw error
      toast.success('Note updated')
      fetchAll()
    } catch (error) {
      toast.error('Failed to update note')
    }
    setEditingNote(null)
    setNoteDraft('')
  }

  function exportDaily() {
    if (daily.length === 0) { toast.error('No data to export'); return }
    const headers = ['Date', 'Transactions', 'Revenue', 'Cash Received', 'Avg Transaction']
    const rows = daily.map(d => {
      const dayTxns = transactions.filter(t => t.created_at?.split('T')[0] === d.sale_date && !t.is_voided).length || 0
      const dayAvg = dayTxns > 0 ? transactions.filter(t => t.created_at?.split('T')[0] === d.sale_date && !t.is_voided).reduce((s, t) => s + Number(t.total_amount), 0) / dayTxns : 0
      return [d.sale_date, d.total_transactions, d.total_revenue, d.cash_total, dayAvg.toFixed(2)]
    })
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales-report-${range}d-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeSales = transactions.filter(s => !s.is_voided)
  const voidedSales = transactions.filter(s => s.is_voided)
  const totalRevenue = daily.reduce((s, d) => s + Number(d.total_revenue), 0)
  const totalCash = daily.reduce((s, d) => s + Number(d.cash_total), 0)
  const totalTxns = daily.reduce((s, d) => s + Number(d.total_transactions), 0)
  const avgTxnValue = activeSales.length > 0 ? activeSales.reduce((s, t) => s + Number(t.total_amount), 0) / activeSales.length : 0
  const topProduct = products.length > 0 ? products[0] : null
  const topProductProfit = topProduct ? topProduct.total_revenue - topProduct.total_cost : 0
  const busiestDay = daily.length > 0 ? daily.reduce((max, d) => Number(d.total_transactions) > Number(max.total_transactions) ? d : max) : null
  const voidRate = totalTxns > 0 ? ((voidedSales.length / totalTxns) * 100).toFixed(1) : '0'

  const chartData = [...daily].reverse().map(d => ({
    date: format(new Date(d.sale_date), 'dd MMM'),
    Revenue: Number(d.cash_total),
  }))

  if (loading) return <LoadingSpinner label="Loading reports..." />

  return (
    <RoleGuard allowed={['owner', 'cashier']}>
      <div className="space-y-6">
        <PageHeader title="Reports & Analytics" description="Track revenue, sales trends, and transaction history" action={
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="date"
              className="input pl-9 py-2"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
            />
            {selectedDate && (
              <button
                type="button"
                onClick={() => setSelectedDate('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
          <select className="input w-auto py-2" value={range} onChange={e => setRange(e.target.value as Range)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <select className="input w-auto py-2" value={filterCashier} onChange={e => setFilterCashier(e.target.value)}>
            <option value="all">All cashiers</option>
            {cashiers.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <select className="input w-auto py-2" value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
            <option value="all">All payments</option>
            <option value="cash">Cash only</option>
            <option value="mpesa">M-Pesa</option>
            <option value="card">Card</option>
          </select>
          <button onClick={fetchAll} className="btn-secondary"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={exportDaily} className="btn-secondary"><Download className="w-4 h-4" /> Export CSV</button>
        </div>
        } />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Revenue', value: formatMoney(totalRevenue, settings.currency), icon: TrendingUp, color: 'text-brand-600 bg-brand-50' },
            { label: 'Transactions', value: totalTxns.toString(), icon: ShoppingBag, color: 'text-sky-600 bg-sky-50' },
            { label: 'Avg Per Sale', value: formatMoney(avgTxnValue, settings.currency), icon: CreditCard, color: 'text-blue-600 bg-blue-50' },
            { label: 'Cancel Rate', value: `${voidRate}%`, icon: Ban, color: 'text-red-600 bg-red-50' },
            { label: 'Cash Received', value: formatMoney(totalCash, settings.currency), icon: Banknote, color: 'text-amber-600 bg-amber-50' },
            { label: 'Top Product', value: topProduct?.name || '—', icon: Percent, color: 'text-emerald-600 bg-emerald-50', subtext: topProduct ? `${formatMoney(topProduct.total_revenue, settings.currency)} revenue • ${formatMoney(topProductProfit, settings.currency)} profit` : '' },
            { label: 'Busiest Day', value: busiestDay ? format(new Date(busiestDay.sale_date), 'dd MMM') : '—', icon: UserIcon, color: 'text-purple-600 bg-purple-50', subtext: busiestDay ? `${busiestDay.total_transactions} sales` : '' },
            { label: 'Cancelled Txns', value: voidedSales.length.toString(), icon: Ban, color: 'text-orange-600 bg-orange-50' },
          ].map(({ label, value, icon: Icon, color, subtext }) => (
            <div key={label} className="stat-card">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}><Icon className="w-5 h-5" /></div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
              <p className="text-lg font-bold text-slate-900 mt-1">{value}</p>
              {subtext && <p className="text-xs text-slate-500 mt-1">{subtext}</p>}
            </div>
          ))}
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-900">Revenue trend</h2>
          </div>
          {chartData.length > 0 && (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} dy={8} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v / 1000}k`} width={50} />
                  <Tooltip formatter={(v: number) => formatMoney(v, settings.currency)} />
                  <Bar dataKey="Revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="flex border-b border-slate-100 mb-4">
            {([
              ['overview', 'Overview'],
              ['top_products', 'Top Products'],
              ['transactions', 'Transactions'],
            ] as [Tab, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Daily breakdown</h3>
                {daily.length === 0 ? <p className="text-sm text-slate-400">No data</p> : daily.slice(0, 7).map(d => (
                  <div key={d.sale_date} className="flex justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="text-sm text-slate-600">{format(new Date(d.sale_date), 'dd MMM yyyy')}</span>
                    <span className="text-sm font-semibold text-slate-900">{formatMoney(Number(d.total_revenue), settings.currency)}</span>
                  </div>
                ))}
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Cash Summary</h3>
                <div className="space-y-2">
                  {[
                    { label: 'Cash from Sales', value: totalCash },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-600">{label}</span>
                        <span className="font-medium text-slate-900">{formatMoney(value, settings.currency)}</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div className="bg-brand-600 h-2 rounded-full" style={{ width: totalRevenue > 0 ? `${(value / totalRevenue) * 100}%` : '0%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {tab === 'top_products' && (
            <div className="overflow-x-auto">
              {products.length === 0 ? <EmptyState icon={TrendingUp} title="No product data" description="Sales data will appear here" /> : (
                <table className="w-full">
                  <thead><tr className="border-b border-slate-100 text-slate-500 text-sm"><th className="py-2 text-left">Product</th><th className="py-2 text-left">Unit</th><th className="py-2 text-right">Units sold</th><th className="py-2 text-right">Revenue</th><th className="py-2 text-right">Cost</th><th className="py-2 text-right">Profit</th></tr></thead>
                  <tbody>{products.map(p => (
                    <tr key={p.name} className="border-b border-slate-50">
                      <td className="py-2 text-sm font-medium text-slate-900">{p.name}</td>
                      <td className="py-2 text-sm text-slate-500">{p.unit}</td>
                      <td className="py-2 text-sm text-right">{p.units_sold}</td>
                      <td className="py-2 text-sm font-semibold text-right">{formatMoney(p.total_revenue, settings.currency)}</td>
                      <td className="py-2 text-sm text-right text-amber-600">{formatMoney(p.total_cost, settings.currency)}</td>
                      <td className="py-2 text-sm font-semibold text-right text-emerald-600">{formatMoney(p.total_revenue - p.total_cost, settings.currency)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}
          {tab === 'transactions' && (
            <div className="space-y-3">
              {transactions.length === 0 ? (
                <EmptyState icon={FileText} title="No transactions" description="Sales will appear here" />
              ) : (
                transactions.map(t => (
                  <div key={t.id} className={`rounded-2xl border p-4 ${t.is_voided ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-sm font-mono font-semibold text-slate-900">#{t.id.slice(0, 8)}</span>
                          <span className="text-sm text-slate-500 capitalize">{t.payment_type}</span>
                          <span className="text-sm text-slate-400">{formatDateTime(t.created_at)}</span>
                          {t.is_voided && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">Cancelled</span>}
                        </div>
<div className="flex items-center gap-3">
                         <span className="text-base font-bold text-slate-900">{formatMoney(Number(t.total_amount), settings.currency)}</span>
                          {canVoidSales(user?.role) && !t.is_voided && (
                            <button onClick={() => cancelSale(t)} className="text-xs text-red-600 hover:text-red-700">Cancel Sale</button>
                          )}
                       </div>
                     </div>
                     {t.customer?.name && <p className="text-xs text-slate-500 mb-2">Customer: {t.customer.name}</p>}
                     {editingNote === t.id ? (
                       <div className="mb-2">
                         <input
                           type="text"
                           value={noteDraft}
                           onChange={e => setNoteDraft(e.target.value)}
                           placeholder="Add note..."
                           className="input text-xs w-full mb-1"
                         />
                         <div className="flex gap-2">
                           <button onClick={() => updateSaleNote(t.id, noteDraft)} className="text-xs btn-primary py-1 px-2">Save</button>
                           <button onClick={() => { setEditingNote(null); setNoteDraft('') }} className="text-xs btn-secondary py-1 px-2">Cancel</button>
                         </div>
                       </div>
                     ) : (
                       <div className="text-xs text-slate-500 mb-2 flex items-center gap-2">
                         <span>Note: {t.note || '—'}</span>
                         {canEditSales(user?.role) && !t.is_voided && (
                           <button onClick={() => { setEditingNote(t.id); setNoteDraft(t.note || '') }} className="text-slate-400 hover:text-brand-600">✏️</button>
                         )}
                       </div>
                     )}
                     <div className="space-y-1">
                      {(t.sale_items || []).map((item, idx) => (
                        <div key={idx} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">{item.product_name || 'Item'}</span>
                            <span className="text-slate-500">x{item.quantity}</span>
                          </div>
                          <div className="flex items-center gap-3 text-slate-600">
                            <span>{formatMoney(Number(item.unit_price), settings.currency)}</span>
                            <span className="font-semibold text-slate-900">{formatMoney(Number(item.subtotal), settings.currency)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {confirm && (
        <Modal
          isOpen={!!confirm}
          onClose={() => setConfirm(null)}
          title={confirm.title}
          description={confirm.description}
          footer={
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirm(null)} className="btn-secondary">Cancel</button>
              <button onClick={confirm.onConfirm} className={confirm.tone === 'danger' ? 'btn-danger' : 'btn-primary'}>{confirm.confirmLabel || 'Confirm'}</button>
            </div>
          }
        >
          <p className="text-sm text-slate-600">{confirm.description}</p>
        </Modal>
      )}
    </RoleGuard>
  )
}
