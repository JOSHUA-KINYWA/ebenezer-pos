'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { formatMoney, formatDate, formatSaleAttribution } from '@/lib/format'
import { canEditSales } from '@/lib/permissions'
import { PageHeader } from '@/components/PageHeader'
import { RoleGuard } from '@/components/RoleGuard'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Alert } from '@/components/Alert'
import { Modal } from '@/components/Modal'
import { 
  ChevronDown, ChevronUp, Trash2, Edit3, Eye, 
  Filter, Calendar, Clock, AlertCircle, CheckCircle2, XCircle,
  ShoppingBag, DollarSign, Wallet, Coins
} from 'lucide-react'

interface SaleItem {
  id: string
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
}

interface Sale {
  id: string
  receipt_no: string
  user_id: string
  user?: { full_name: string; role?: string }
  total_amount: number
  subtotal: number
  tax_amount: number
  payment_type: string
  payment_method: string
  discount: number
  is_voided: boolean
  created_at: string
  items?: SaleItem[]
}

export default function MySalesPage() {
  const [user] = useState(getSession())
  const supabase = createClient()
  
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedSale, setExpandedSale] = useState<string | null>(null)
  const [editingSale, setEditingSale] = useState<Sale | null>(null)
  const [editDiscount, setEditDiscount] = useState(0)
  const [editPaymentMethod, setEditPaymentMethod] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [viewScope, setViewScope] = useState<'mine' | 'all'>('mine')
  const [staffFilter, setStaffFilter] = useState('all')
  const [excludeStaffId, setExcludeStaffId] = useState('')

  const [staffMembers, setStaffMembers] = useState<{ id: string; full_name: string; role: string }[]>([])

  useEffect(() => {
    supabase
      .from('users')
      .select('id, full_name, role')
      .eq('is_active', true)
      .in('role', ['owner', 'cashier'])
      .order('full_name')
      .then(({ data }) => setStaffMembers(data || []))
  }, [])

  useEffect(() => {
    fetchSales()
  }, [period, customStartDate, customEndDate, user, viewScope, staffFilter, excludeStaffId])

  async function fetchSales() {
    if (!user) return
    setLoading(true)
    setError('')
    
    try {
      const now = new Date()
      let startDate = new Date()
      
      // Use custom dates if provided
      if (customStartDate && customEndDate) {
        startDate = new Date(customStartDate + 'T00:00:00')
        const endDate = new Date(customEndDate + 'T23:59:59')
        var startISO = startDate.toISOString()
        var endISO = endDate.toISOString()
      } else {
        // Use period
        if (period === 'day') {
          startDate.setHours(0, 0, 0, 0)
        } else if (period === 'week') {
          const day = now.getDay()
          startDate.setDate(now.getDate() - day)
          startDate.setHours(0, 0, 0, 0)
        } else {
          startDate.setDate(1)
          startDate.setHours(0, 0, 0, 0)
        }

        startISO = startDate.toISOString()
        endISO = now.toISOString()
      }

      // Get sales for the period
      let query = supabase
        .from('sales')
        .select('id, receipt_no, user_id, total_amount, subtotal, tax_amount, payment_type, payment_method, discount, is_voided, created_at')
        .gte('created_at', startISO)
        .lte('created_at', endISO)

      // Scope: cashiers default to own sales; can switch to all shop sales
      if (user.role === 'cashier' && viewScope === 'mine') {
        query = query.eq('user_id', user.id)
      } else if (user.role === 'owner' && staffFilter !== 'all') {
        query = query.eq('user_id', staffFilter)
      } else if (user.role === 'cashier' && viewScope === 'all' && excludeStaffId) {
        query = query.neq('user_id', excludeStaffId)
      }

      query = query.order('created_at', { ascending: false })

      const { data, error: queryError } = await query

      if (queryError) throw queryError

      // Fetch user details and items for each sale
      if (data) {
        const salesWithDetails = await Promise.all(
          (data as Sale[]).map(async (sale) => {
            // Get user details
            const { data: userData } = await supabase
              .from('users')
              .select('full_name, role')
              .eq('id', sale.user_id)
              .maybeSingle()

            // Get sale items
            const { data: itemsData } = await supabase
              .from('sale_items')
              .select('id, product_name, quantity, unit_price, subtotal')
              .eq('sale_id', sale.id)

            return {
              ...sale,
              user: userData || undefined,
              items: (itemsData as SaleItem[]) || [],
            }
          })
        )

        setSales(salesWithDetails)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sales'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleEditSale(sale: Sale) {
    setSavingEdit(true)
    try {
      const { error } = await supabase
        .from('sales')
        .update({
          discount: editDiscount,
          payment_method: editPaymentMethod,
          total_amount: sale.subtotal + sale.tax_amount - editDiscount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sale.id)

      if (error) throw error

      setEditingSale(null)
      setEditDiscount(0)
      setEditPaymentMethod('')
      fetchSales()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update sale')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleVoidSale(saleId: string) {
    if (!voidReason.trim()) {
      setError('Please provide a reason for canceling this sale')
      return
    }

    setCancelingId(saleId)
    try {
      // Get the sale to restore stock
      const sale = sales.find(s => s.id === saleId)
      if (!sale || !sale.items) {
        throw new Error('Sale not found')
      }

      // Restore stock for each item
      for (const item of sale.items) {
        const { data: product } = await supabase
          .from('products')
          .select('id, stock_qty')
          .eq('name', item.product_name)
          .maybeSingle()

        if (product) {
          await supabase
            .from('products')
            .update({ stock_qty: product.stock_qty + item.quantity })
            .eq('id', product.id)

          // Log stock adjustment
          await supabase
            .from('stock_log')
            .insert({
              product_id: product.id,
              change_qty: item.quantity,
              reason: 'return',
              note: `Sale ${sale.receipt_no} canceled - ${voidReason}`,
            })
        }
      }

      // Mark sale as voided
      const { error } = await supabase
        .from('sales')
        .update({
          is_voided: true,
          voided_at: new Date().toISOString(),
          voided_by: user?.id,
          void_reason: voidReason,
        })
        .eq('id', saleId)

      if (error) throw error

      setVoidReason('')
      setCancelingId(null)
      setExpandedSale(null)
      fetchSales()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel sale')
    } finally {
      setCancelingId(null)
    }
  }

  const stats = useMemo(() => {
    const activeSales = sales.filter(s => !s.is_voided)
    return {
      count: activeSales.length,
      total: activeSales.reduce((sum, s) => sum + s.total_amount, 0),
      cash: activeSales.filter(s => s.payment_method === 'cash').reduce((sum, s) => sum + s.total_amount, 0),
      till: activeSales.filter(s => s.payment_method === 'till').reduce((sum, s) => sum + s.total_amount, 0),
      coin: activeSales.filter(s => s.payment_method === 'coin').reduce((sum, s) => sum + s.total_amount, 0),
    }
  }, [sales])

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner label="Loading sales..." /></div>

  return (
    <RoleGuard allowed={['owner', 'cashier']}>
      <div className="space-y-6">
        <PageHeader
          title="My Sales"
          description={
            user?.role === 'cashier'
              ? viewScope === 'mine'
                ? 'Your personal transactions'
                : 'All shop sales with staff attribution'
              : 'View and manage sales by staff member'
          }
        />

        {error && <Alert type="error" title="Error" message={error} dismissible onDismiss={() => setError('')} />}

        <div className="card border border-slate-200/80 shadow-sm">
          <div className="p-4 border-b border-slate-100">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Filters</h3>
                <p className="text-xs text-slate-500">Refine the sales list below by period, staff, and date range.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl border border-slate-200 bg-white p-1">
                  {(['day', 'week', 'month'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        period === p
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p === 'day' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              {user?.role === 'cashier' && (
                <div className="flex rounded-xl border border-slate-200 bg-white p-1">
                  <button
                    onClick={() => { setViewScope('mine'); setExcludeStaffId('') }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      viewScope === 'mine'
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    My sales
                  </button>
                  <button
                    onClick={() => { setViewScope('all'); setExcludeStaffId('') }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      viewScope === 'all'
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    All sales
                  </button>
                </div>
              )}
              {user?.role === 'owner' && (
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Sold by</label>
                  <select className="input w-auto" value={staffFilter} onChange={e => setStaffFilter(e.target.value)}>
                    <option value="all">All staff</option>
                    {staffMembers.map(member => (
                      <option key={member.id} value={member.id}>{formatSaleAttribution(member)}</option>
                    ))}
                  </select>
                </div>
              )}
              {user?.role === 'cashier' && viewScope === 'all' && (
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Exclude sales by</label>
                  <select className="input w-auto" value={excludeStaffId} onChange={e => setExcludeStaffId(e.target.value)}>
                    <option value="">No exclusion</option>
                    {staffMembers.filter(member => member.id !== user?.id).map(member => (
                      <option key={member.id} value={member.id}>{formatSaleAttribution(member)}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">From</label>
                  <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="input" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">To</label>
                  <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="input" />
                </div>
                {(customStartDate || customEndDate) && (
                  <button
                    onClick={() => { setCustomStartDate(''); setCustomEndDate('') }}
                    className="btn-secondary px-3 py-2 text-xs"
                  >
                    Clear dates
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {[
            { label: 'Transactions', value: stats.count.toString(), icon: ShoppingBag, color: 'bg-slate-50 text-slate-700' },
            { label: 'Total Revenue', value: formatMoney(stats.total), icon: DollarSign, color: 'bg-brand-50 text-brand-700' },
            { label: 'Cash', value: formatMoney(stats.cash), icon: Wallet, color: 'bg-emerald-50 text-emerald-700' },
            { label: 'Till', value: formatMoney(stats.till), icon: Wallet, color: 'bg-amber-50 text-amber-700' },
            { label: 'Coin', value: formatMoney(stats.coin), icon: Coins, color: 'bg-sky-50 text-sky-700' },
          ].map(item => (
            <div key={item.label} className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className="text-xl font-bold text-slate-900 mt-2">{item.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${item.color}`}>
                  <item.icon className="w-4 h-4" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card border border-slate-200/80 shadow-sm">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Sales Transactions</h3>
              <p className="text-xs text-slate-500">Tap a receipt to view line items and actions.</p>
            </div>
            {sales.length > 0 && (
              <span className="text-xs font-medium text-slate-500">{sales.length} record{sales.length === 1 ? '' : 's'}</span>
            )}
          </div>

          {sales.length === 0 ? (
            <div className="p-10 text-center text-slate-500">
              <Calendar className="w-10 h-10 mx-auto mb-3 opacity-60" />
              <p className="text-sm font-medium">No sales in this period</p>
              <p className="text-xs text-slate-400 mt-1">Sales will appear here once transactions are recorded.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sales.map(sale => {
                const isExpanded = expandedSale === sale.id
                return (
                  <div key={sale.id} className={`hover:bg-slate-50/70 transition ${sale.is_voided ? 'opacity-70' : ''}`}>
                    <div
                      className="p-4 cursor-pointer flex items-center justify-between gap-4"
                      onClick={() => setExpandedSale(isExpanded ? null : sale.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900 text-sm">{sale.receipt_no}</p>
                          {sale.is_voided ? (
                            <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 border border-red-100">Canceled</span>
                          ) : (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-100">Active</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {(viewScope === 'all' || user?.role === 'owner') && sale.user && (
                            <span>{formatSaleAttribution(sale.user)} • </span>
                          )}
                          {formatDate(sale.created_at)} • <span className="capitalize">{sale.payment_method}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900 text-sm">{formatMoney(sale.total_amount)}</p>
                        <p className="text-[11px] text-slate-500">{sale.items?.length || 0} item{sale.items?.length === 1 ? '' : 's'}</p>
                      </div>
                      <div className="text-slate-400">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-slate-50/80 px-4 pb-4 pt-2">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Subtotal</p>
                            <p className="text-sm font-semibold text-slate-900 mt-1">{formatMoney(sale.subtotal)}</p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Tax</p>
                            <p className="text-sm font-semibold text-slate-900 mt-1">{formatMoney(sale.tax_amount)}</p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Discount</p>
                            <p className="text-sm font-semibold text-slate-900 mt-1">{formatMoney(sale.discount)}</p>
                          </div>
                          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">Total</p>
                            <p className="text-sm font-bold text-brand-700 mt-1">{formatMoney(sale.total_amount)}</p>
                          </div>
                        </div>

                        {sale.items && sale.items.length > 0 && (
                          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-slate-50 text-slate-500 text-xs">
                                  <th className="py-2 px-3 text-left font-semibold">Item</th>
                                  <th className="py-2 px-3 text-right font-semibold">Qty</th>
                                  <th className="py-2 px-3 text-right font-semibold">Unit price</th>
                                  <th className="py-2 px-3 text-right font-semibold">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {sale.items.map(item => (
                                  <tr key={item.id} className="hover:bg-slate-50/60">
                                    <td className="py-2 px-3 text-slate-900 font-medium">{item.product_name}</td>
                                    <td className="py-2 px-3 text-right text-slate-600">{item.quantity}</td>
                                    <td className="py-2 px-3 text-right text-slate-600">{formatMoney(item.unit_price)}</td>
                                    <td className="py-2 px-3 text-right font-semibold text-slate-900">{formatMoney(item.subtotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {!sale.is_voided && canEditSales(user?.role) && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                setEditingSale(sale)
                                setEditDiscount(sale.discount)
                                setEditPaymentMethod(sale.payment_method)
                              }}
                              className="btn-primary inline-flex items-center gap-2 text-xs"
                            >
                              <Edit3 className="w-4 h-4" /> Edit
                            </button>
                            <button
                              onClick={() => {
                                setVoidReason('')
                                setCancelingId(sale.id)
                              }}
                              className="btn-danger inline-flex items-center gap-2 text-xs"
                            >
                              <Trash2 className="w-4 h-4" /> Cancel sale
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {editingSale && (
          <Modal
            isOpen={!!editingSale}
            onClose={() => setEditingSale(null)}
            title="Edit Sale"
            description={`Editing sale ${editingSale.receipt_no}`}
            footer={
              <div className="flex justify-end gap-3">
                <button onClick={() => setEditingSale(null)} className="btn-secondary">Cancel</button>
                <button
                  onClick={() => handleEditSale(editingSale)}
                  disabled={savingEdit}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" /> {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-700 mb-1">Payment Method</p>
                <select
                  value={editPaymentMethod}
                  onChange={e => setEditPaymentMethod(e.target.value)}
                  className="input w-full"
                >
                  <option value="cash">Cash</option>
                  <option value="coin">Coin</option>
                  <option value="till">Till</option>
                </select>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700 mb-1">Discount (KSh)</p>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editDiscount}
                  onChange={e => setEditDiscount(parseFloat(e.target.value) || 0)}
                  className="input w-full"
                />
                <p className="text-xs text-slate-500 mt-1">
                  New total: {formatMoney(editingSale.subtotal + editingSale.tax_amount - editDiscount)}
                </p>
              </div>
            </div>
          </Modal>
        )}

        {cancelingId && (
          <Modal
            isOpen={!!cancelingId}
            onClose={() => setCancelingId(null)}
            title="Cancel Sale"
            description="This will restore stock and void the sale."
            footer={
              <div className="flex justify-end gap-3">
                <button onClick={() => setCancelingId(null)} className="btn-secondary">Close</button>
                <button
                  onClick={() => handleVoidSale(cancelingId)}
                  disabled={!voidReason.trim()}
                  className="btn-danger inline-flex items-center gap-2"
                >
                  <XCircle className="w-4 h-4" /> Confirm Cancel
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">
                  Canceling a sale will restore all items to inventory and cannot be undone.
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700 mb-1">Reason for cancellation</p>
                <textarea
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  className="input w-full h-20 resize-none"
                  placeholder="Enter reason..."
                />
              </div>
            </div>
          </Modal>
        )}
      </div>
    </RoleGuard>
  )
}
