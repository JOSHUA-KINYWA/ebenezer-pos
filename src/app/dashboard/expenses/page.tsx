'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { RoleGuard } from '@/components/RoleGuard'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { getSession } from '@/lib/auth'
import { formatDate, formatMoney } from '@/lib/format'
import { Expense, SessionUser } from '@/types'
import { Search, Filter, Plus, ArrowDownRight, ArrowUpRight, Trash2 } from 'lucide-react'

type PaymentMethod = 'cash' | 'coin' | 'till'

export default function ExpensesPage() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [search, setSearch] = useState('')
  const [filterPayment, setFilterPayment] = useState('all')
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null)
  const [form, setForm] = useState({
    item_name: '',
    amount: '',
    payment_method: 'cash' as PaymentMethod,
    vendor: '',
    category: '',
    payment_note: '',
  })
  const today = useRef(new Date().toISOString().split('T')[0])
  const { settings } = useShopSettings()
  const toast = useToast()
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const session = getSession()
    if (!session) {
      router.push('/login')
      return
    }
    setUser(session)
  }, [router])

  useEffect(() => {
    if (user) fetchExpenses()
  }, [user])

  async function fetchExpenses() {
    setLoading(true)
    setError('')

    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) {
        setError(error.message)
        toast.error(`❌ Failed to load expenses: ${error.message}`)
        setExpenses([])
      } else {
        setExpenses((data || []) as Expense[])
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error loading expenses.'
      setError(message)
      toast.error(`❌ ${message}`)
      setExpenses([])
    } finally {
      setLoading(false)
    }
  }

  const totals = useMemo(() => {
      const total = expenses.reduce((sum, next) => sum + Number(next.amount), 0)
      const breakdown = expenses.reduce(
        (acc, expense) => {
          acc[expense.payment_method] = (acc[expense.payment_method] ?? 0) + Number(expense.amount)
          return acc
        },
        { cash: 0, coin: 0, till: 0 } as Record<PaymentMethod, number>
      )

      return { total, breakdown }
    }, [expenses])
  const filtered = useMemo(
    () => expenses.filter(expense => {
      const matchesSearch =
        !search ||
        expense.item_name.toLowerCase().includes(search.toLowerCase()) ||
        (expense.vendor ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (expense.category ?? '').toLowerCase().includes(search.toLowerCase())
      const matchesPayment = filterPayment === 'all' || expense.payment_method === filterPayment
      return matchesSearch && matchesPayment
    }),
    [expenses, search, filterPayment]
  )

  async function handleDeleteExpense(expense: Expense) {
    const confirmed = window.confirm(`Delete expense "${expense.item_name}"? This will also adjust the drawer balance for ${expense.expense_date}.`)
    if (!confirmed) return

    setDeletingExpenseId(expense.id)
    try {
      const { data: existing } = await supabase
        .from('drawer_balances')
        .select('id, cash, coin, till')
        .eq('date', expense.expense_date)
        .is('shift_id', null)
        .maybeSingle()

      const current = existing || { cash: 0, coin: 0, till: 0 }
      const nextBalance: any = { date: expense.expense_date, shift_id: null }

      if (expense.payment_method === 'cash') {
        nextBalance.cash = Number(current.cash || 0) + Number(expense.amount)
      } else if (expense.payment_method === 'coin') {
        nextBalance.coin = Number(current.coin || 0) + Number(expense.amount)
      } else {
        nextBalance.till = Number(current.till || 0) + Number(expense.amount)
      }

      if (existing) {
        await supabase.from('drawer_balances').update(nextBalance).eq('id', existing.id)
      } else {
        await supabase.from('drawer_balances').insert(nextBalance)
      }
      const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
      if (error) throw error

      window.dispatchEvent(new Event('drawer-update'))
      toast.success('Expense removed and drawer balance updated')
      await fetchExpenses()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete expense'
      toast.error(`❌ ${message}`)
    } finally {
      setDeletingExpenseId(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.item_name.trim()) {
      toast.error('❌ Item name is required')
      return
    }

    if (!form.amount) {
      toast.error('❌ Amount is required')
      return
    }

    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) {
      toast.error('❌ Enter a valid amount (must be greater than 0)')
      return
    }

    if (amount > 10000) {
      const confirm = window.confirm(`⚠️ Large expense detected (${formatMoney(amount, settings.currency)}). Confirm this transaction?`)
      if (!confirm) {
        toast.info('💭 Expense cancelled')
        setSubmitting(false)
        return
      }
    }

    if (!form.category.trim()) {
      toast.info('ℹ️ No category selected - expense recorded as miscellaneous')
    }

    setSubmitting(true)
    const todayString = today.current

    const { data: existing } = await supabase
      .from('drawer_balances')
      .select('id, cash, coin, till')
      .eq('date', todayString)
      .is('shift_id', null)
      .maybeSingle()

    const drawer = existing || { cash: 0, coin: 0, till: 0 }
    const cashBalance = Number(drawer.cash || 0)
    const coinBalance = Number(drawer.coin || 0)
    const tillBalance = Number(drawer.till || 0)
    const totalDrawer = cashBalance + coinBalance + tillBalance

    const selectedBalance = Number(drawer[form.payment_method] || 0)
    const shortage = amount - selectedBalance
    const otherMethods: PaymentMethod[] = ['cash', 'coin', 'till'].filter(m => m !== form.payment_method) as PaymentMethod[]
    const methodLabel = form.payment_method.toUpperCase()

    let confirmedPayment = form.payment_method
    let confirmedAmount = amount

    if (shortage > 0 && totalDrawer >= amount) {
      const fallback = otherMethods.find(method => Number(drawer[method] || 0) >= shortage)
      if (fallback) {
        const fallbackLabel = fallback.toUpperCase()
        const proceed = window.confirm(
          `⚠️ ${methodLabel} is short by ${formatMoney(shortage, settings.currency)}.\n\n` +
          `${methodLabel} available: ${formatMoney(selectedBalance, settings.currency)}\n` +
          `${fallbackLabel} available: ${formatMoney(Number(drawer[fallback] || 0), settings.currency)}\n\n` +
          `Pay ${formatMoney(selectedBalance, settings.currency)} from ${methodLabel} ` +
          `and ${formatMoney(shortage, settings.currency)} from ${fallbackLabel} instead?`
        )
        if (proceed) {
          confirmedPayment = form.payment_method
          confirmedAmount = amount
        } else {
          toast.info('💭 Expense cancelled')
          setSubmitting(false)
          return
        }
      } else {
        const totalOther = otherMethods.reduce((sum, method) => sum + Number(drawer[method] || 0), 0)
        if (totalOther >= shortage && (otherMethods.length === 2 || otherMethods.length === 1)) {
          const parts = otherMethods.map(method => `${method.toUpperCase()}: ${formatMoney(Number(drawer[method] || 0), settings.currency)}`).join('\n')
          const proceed = window.confirm(
            `⚠️ ${methodLabel} does not fully cover this expense.\n\n` +
            `Available across other methods:\n${parts}\n\n` +
            `Use available funds from other methods so no drawer goes negative?`
          )
          if (!proceed) {
            toast.info('💭 Expense cancelled')
            setSubmitting(false)
            return
          }
          confirmedPayment = form.payment_method
          confirmedAmount = amount
        } else {
          const proceed = window.confirm(
            `⚠️ Not enough funds across drawer to cover this expense.\n\n` +
            `Total drawer: ${formatMoney(totalDrawer, settings.currency)}\n` +
            `Expense:    ${formatMoney(amount, settings.currency)}\n\n` +
            `Record expense anyway without touching drawer balances?`
          )
          if (!proceed) {
            toast.info('💭 Expense cancelled')
            setSubmitting(false)
            return
          }
          confirmedPayment = form.payment_method
          confirmedAmount = amount
        }
      }
    }

    if (shortage <= 0 && !window.confirm(`Record expense: ${form.item_name.trim()} for ${formatMoney(amount, settings.currency)} via ${methodLabel}?`)) {
      toast.info('💭 Expense cancelled')
      setSubmitting(false)
      return
    }

    const { error: insertError } = await supabase.from('expenses').insert({
      item_name: form.item_name.trim(),
      amount,
      payment_method: confirmedPayment,
      vendor: form.vendor.trim() || null,
      category: form.category.trim() || 'Miscellaneous',
      payment_note: form.payment_note.trim() || null,
      expense_date: todayString,
      created_by: user?.id,
    })

    if (insertError) {
      toast.error(`❌ Failed to record expense: ${insertError.message}`)
      setSubmitting(false)
      return
    }

    const nextBalance: any = { date: todayString, shift_id: null, cash: cashBalance, coin: coinBalance, till: tillBalance }

    if (shortage <= 0) {
      if (form.payment_method === 'cash') nextBalance.cash = cashBalance - amount
      else if (form.payment_method === 'coin') nextBalance.coin = coinBalance - amount
      else nextBalance.till = tillBalance - amount
    } else if (totalDrawer >= amount) {
      const fallback = otherMethods.find(method => Number(drawer[method] || 0) >= shortage)
      if (fallback) {
        const usedFromFallback = Math.min(shortage, Number(drawer[fallback] || 0))
        const usedFromSelected = Math.max(0, amount - usedFromFallback)
        if (form.payment_method === 'cash') nextBalance.cash = Math.max(0, cashBalance - usedFromSelected)
        else if (form.payment_method === 'coin') nextBalance.coin = Math.max(0, coinBalance - usedFromSelected)
        else nextBalance.till = Math.max(0, tillBalance - usedFromSelected)
        if (fallback === 'cash') nextBalance.cash = Math.max(0, cashBalance - usedFromFallback)
        else if (fallback === 'coin') nextBalance.coin = Math.max(0, coinBalance - usedFromFallback)
        else nextBalance.till = Math.max(0, tillBalance - usedFromFallback)
      } else {
        const remaining = amount
        let availableCash = cashBalance
        let availableCoin = coinBalance
        let availableTill = tillBalance
        let stillNeed = remaining
        const useFrom = (key: string, balance: number) => {
          const use = Math.min(balance, stillNeed)
          stillNeed -= use
          if (key === 'cash') nextBalance.cash = Math.max(0, availableCash - use)
          if (key === 'coin') nextBalance.coin = Math.max(0, availableCoin - use)
          if (key === 'till') nextBalance.till = Math.max(0, availableTill - use)
          return use
        }
        useFrom(form.payment_method, Number(drawer[form.payment_method] || 0))
        for (const method of otherMethods) {
          if (stillNeed <= 0) break
          useFrom(method, Number(drawer[method] || 0))
        }
      }
    }

    if (existing) {
      const { error } = await supabase.from('drawer_balances').update(nextBalance).eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('drawer_balances').insert(nextBalance)
      if (error) throw error
    }

    window.dispatchEvent(new Event('drawer-update'))
    toast.success(`✓ Expense recorded: ${form.item_name.trim()} for ${formatMoney(amount, settings.currency)}`)
    setForm({ ...form, item_name: '', amount: '', vendor: '', category: '', payment_note: '' })
    setSubmitting(false)
    fetchExpenses()
  }

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner label="Loading expenses..." /></div>
  if (error) return <div className="flex items-center justify-center py-20 text-center text-sm text-red-600">{error}</div>

  return (
    <RoleGuard allowed={['owner']}>
      <div className="space-y-6">
        <PageHeader title="Expenses" description="Record and monitor shop costs" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Total Expenses</p>
            <p className="text-3xl font-bold text-slate-900 mt-3">{formatMoney(totals.total, settings.currency)}</p>
          </div>
          <div className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Cash</p>
            <p className="text-2xl font-bold text-slate-900 mt-3">{formatMoney(totals.breakdown.cash, settings.currency)}</p>
          </div>
          <div className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Till & Coin</p>
            <p className="text-2xl font-bold text-slate-900 mt-3">{formatMoney(totals.breakdown.coin + totals.breakdown.till, settings.currency)}</p>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Record a new expense</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="label">Item name *</label>
              <input
                className="input"
                value={form.item_name}
                onChange={e => setForm({ ...form, item_name: e.target.value })}
                placeholder="Electricity, supplies..."
                required
              />
            </div>
            <div className="space-y-2">
              <label className="label">Amount *</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="label">Payment method</label>
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'coin', 'till'] as PaymentMethod[]).map(method => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setForm({ ...form, payment_method: method })}
                    className={`btn-sm ${form.payment_method === method ? 'btn-primary' : 'btn-secondary'} w-full`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 lg:col-span-2">
              <label className="label">Vendor</label>
              <input
                className="input"
                value={form.vendor}
                onChange={e => setForm({ ...form, vendor: e.target.value })}
                placeholder="Supplier or merchant"
              />
            </div>
            <div className="space-y-2">
              <label className="label">Category</label>
              <input
                className="input"
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                placeholder="Utilities, supplies, rent"
              />
            </div>
            <div className="space-y-2 lg:col-span-3">
              <label className="label">Note</label>
              <textarea
                className="input"
                rows={3}
                value={form.payment_note}
                onChange={e => setForm({ ...form, payment_note: e.target.value })}
                placeholder="Optional note"
              />
            </div>
            <div className="lg:col-span-3">
              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? 'Recording...' : 'Record Expense'}
              </button>
            </div>
          </form>
        </div>

        <div className="card p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                className="input pl-10"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search expenses..."
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select className="input w-40" value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
                <option value="all">All payments</option>
                <option value="cash">Cash</option>
                <option value="coin">Coin</option>
                <option value="till">Till</option>
              </select>
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Plus} title="No expenses found" description="Record expenses to see them here." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="table-head">Date</th>
                  <th className="table-head">Item</th>
                  <th className="table-head">Vendor</th>
                  <th className="table-head">Category</th>
                  <th className="table-head">Method</th>
                  <th className="table-head text-right">Amount</th>
                  <th className="table-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(expense => (
                  <tr key={expense.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="table-cell text-slate-500">{formatDate(expense.expense_date)}</td>
                    <td className="table-cell font-medium text-slate-900">{expense.item_name}</td>
                    <td className="table-cell text-slate-500">{expense.vendor || '—'}</td>
                    <td className="table-cell text-slate-500">{expense.category || '—'}</td>
                    <td className="table-cell capitalize">{expense.payment_method}</td>
                    <td className="table-cell text-right font-semibold text-red-600">-{formatMoney(Number(expense.amount), settings.currency)}</td>
                    <td className="table-cell text-right">
                      <button
                        onClick={() => handleDeleteExpense(expense)}
                        disabled={deletingExpenseId === expense.id}
                        className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-60"
                      >
                        <Trash2 className="w-4 h-4" /> {deletingExpenseId === expense.id ? 'Removing...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RoleGuard>
  )
}
