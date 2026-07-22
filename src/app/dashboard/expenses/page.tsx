'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { RoleGuard } from '@/components/RoleGuard'
import { Modal } from '@/components/Modal'
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
  const [showTopUpModal, setShowTopUpModal] = useState(false)
  const [pendingExpense, setPendingExpense] = useState<{
    item_name: string
    amount: number
    payment_method: PaymentMethod
    vendor: string
    category: string
    payment_note: string
  } | null>(null)
  const [topUpShortfall, setTopUpShortfall] = useState(0)
  const [topUpBalances, setTopUpBalances] = useState({ cash: 0, coin: 0, till: 0 })
  const [topUpDeductions, setTopUpDeductions] = useState({ cash: 0, coin: 0, till: 0 })
  const [topUpSubmitting, setTopUpSubmitting] = useState(false)
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
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const current = existing || { cash: 0, coin: 0, till: 0 }
      const nextBalance: any = { cash: current.cash, coin: current.coin, till: current.till, updated_at: new Date().toISOString() }

      const totalDeducted = Number(expense.cash_deducted || 0) + Number(expense.coin_deducted || 0) + Number(expense.till_deducted || 0)
      if (totalDeducted === 0) {
        if (expense.payment_method === 'cash') {
          nextBalance.cash = Number(current.cash || 0) + Number(expense.amount)
        } else if (expense.payment_method === 'coin') {
          nextBalance.coin = Number(current.coin || 0) + Number(expense.amount)
        } else {
          nextBalance.till = Number(current.till || 0) + Number(expense.amount)
        }
      } else {
        nextBalance.cash = Number(current.cash || 0) + Number(expense.cash_deducted || 0)
        nextBalance.coin = Number(current.coin || 0) + Number(expense.coin_deducted || 0)
        nextBalance.till = Number(current.till || 0) + Number(expense.till_deducted || 0)
      }

      const drawerResult = existing?.id
        ? await supabase.from('drawer_balances').update(nextBalance).eq('id', existing.id)
        : await supabase.from('drawer_balances').insert({ date: expense.expense_date, shift_id: null, ...nextBalance })
      if (drawerResult.error) throw drawerResult.error
      const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
      if (error) throw error

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
        return
      }
    }

    if (!form.category.trim()) {
      toast.info('ℹ️ No category selected - expense recorded as miscellaneous')
    }

    setSubmitting(true)
    const todayString = today.current

    try {
      const { data: existing } = await supabase
        .from('drawer_balances')
        .select('id, cash, coin, till')
        .eq('date', todayString)
        .is('shift_id', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const current = existing || { cash: 0, coin: 0, till: 0 }
      const methodBalance = Number(current[form.payment_method] || 0)

      if (methodBalance < amount) {
        const otherMethods: ('cash' | 'coin' | 'till')[] = form.payment_method === 'cash'
          ? ['coin', 'till']
          : form.payment_method === 'coin'
            ? ['cash', 'till']
            : ['cash', 'coin']

        setTopUpShortfall(amount - methodBalance)
        setTopUpBalances({
          cash: Number(current.cash || 0),
          coin: Number(current.coin || 0),
          till: Number(current.till || 0),
        })
        setTopUpDeductions({
          cash: 0,
          coin: 0,
          till: 0,
        })
        setPendingExpense({
          item_name: form.item_name.trim(),
          amount,
          payment_method: form.payment_method,
          vendor: form.vendor.trim(),
          category: form.category.trim() || 'Miscellaneous',
          payment_note: form.payment_note.trim(),
        })
        setShowTopUpModal(true)
        setSubmitting(false)
        return
      }

      const deductions: Record<PaymentMethod, number> = { cash: 0, coin: 0, till: 0 }
      deductions[form.payment_method] = amount
      await createExpense(
        form.item_name.trim(),
        amount,
        form.payment_method,
        deductions,
        form.vendor.trim() || undefined,
        form.category.trim() || undefined,
        form.payment_note.trim() || undefined,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to record expense'
      toast.error(`❌ ${message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function createExpense(
    item_name: string,
    amount: number,
    primaryMethod: PaymentMethod,
    deductions: Record<PaymentMethod, number>,
    vendor?: string,
    category?: string,
    payment_note?: string,
  ) {
    const todayString = today.current

    const { error: insertError } = await supabase.from('expenses').insert({
      item_name,
      amount,
      payment_method: primaryMethod,
      vendor: vendor || null,
      category: category || 'Miscellaneous',
      payment_note: payment_note || null,
      expense_date: todayString,
      created_by: user?.id,
      cash_deducted: Number(deductions.cash || 0),
      coin_deducted: Number(deductions.coin || 0),
      till_deducted: Number(deductions.till || 0),
    })

    if (insertError) throw insertError

    const { data: existing } = await supabase
      .from('drawer_balances')
      .select('id, cash, coin, till')
      .eq('date', todayString)
      .is('shift_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const current = existing || { cash: 0, coin: 0, till: 0 }
    const nextBalance: any = {
      cash: Number(current.cash || 0) - Number(deductions.cash || 0),
      coin: Number(current.coin || 0) - Number(deductions.coin || 0),
      till: Number(current.till || 0) - Number(deductions.till || 0),
      updated_at: new Date().toISOString(),
    }

    const drawerResult = existing?.id
      ? await supabase.from('drawer_balances').update(nextBalance).eq('id', existing.id)
      : await supabase.from('drawer_balances').insert({ date: todayString, shift_id: null, ...nextBalance })
    if (drawerResult.error) throw drawerResult.error

    toast.success(`✓ Expense recorded: ${item_name} for ${formatMoney(amount, settings.currency)}`)
    setForm({ item_name: '', amount: '', payment_method: 'cash', vendor: '', category: '', payment_note: '' })
    setPendingExpense(null)
    setShowTopUpModal(false)
    fetchExpenses()
  }

  async function handleTopUpSubmit(_e?: React.FormEvent) {
    if (!pendingExpense) return

    const totalDeductions = topUpDeductions.cash + topUpDeductions.coin + topUpDeductions.till
    if (totalDeductions < topUpShortfall) {
      toast.error(`❌ You need to cover a shortfall of ${formatMoney(topUpShortfall, settings.currency)}`)
      return
    }

    if (topUpDeductions.cash > topUpBalances.cash) {
      toast.error('❌ Cash deduction exceeds available balance')
      return
    }
    if (topUpDeductions.coin > topUpBalances.coin) {
      toast.error('❌ Coin deduction exceeds available balance')
      return
    }
    if (topUpDeductions.till > topUpBalances.till) {
      toast.error('❌ Till deduction exceeds available balance')
      return
    }

    setTopUpSubmitting(true)
    try {
      await createExpense(
        pendingExpense.item_name,
        pendingExpense.amount,
        pendingExpense.payment_method,
        topUpDeductions,
        pendingExpense.vendor,
        pendingExpense.category,
        pendingExpense.payment_note,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to record expense'
      toast.error(`❌ ${message}`)
      setTopUpSubmitting(false)
    }
  }

  function updateTopUpDeduction(method: 'cash' | 'coin' | 'till', value: number) {
    setTopUpDeductions(prev => ({ ...prev, [method]: Math.max(0, value) }))
  }

  const otherMethods = useMemo(() => {
    if (!showTopUpModal || !pendingExpense) return []
    const methods: ('cash' | 'coin' | 'till')[] = pendingExpense.payment_method === 'cash'
      ? ['coin', 'till']
      : pendingExpense.payment_method === 'coin'
        ? ['cash', 'till']
        : ['cash', 'coin']
    return methods.map(m => ({ method: m, available: topUpBalances[m] }))
  }, [showTopUpModal, pendingExpense, topUpBalances])

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

      <Modal
        isOpen={showTopUpModal}
        onClose={() => {
          setShowTopUpModal(false)
          setPendingExpense(null)
          setSubmitting(false)
        }}
        title="Insufficient funds"
        description={`${pendingExpense?.payment_method?.toUpperCase() || ''} balance is less than the expense amount.`}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowTopUpModal(false)
                setPendingExpense(null)
                setSubmitting(false)
              }}
              className="btn-secondary"
              disabled={topUpSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleTopUpSubmit}
              className="btn-primary"
              disabled={topUpSubmitting}
            >
              {topUpSubmitting ? 'Recording...' : 'Record Expense'}
            </button>
          </div>
        }
      >
        {pendingExpense && (
          <form onSubmit={handleTopUpSubmit} className="space-y-5">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-medium">Expense: {pendingExpense.item_name}</p>
              <p className="mt-1">
                Amount: <span className="font-semibold">{formatMoney(pendingExpense.amount, settings.currency)}</span>
              </p>
              <p className="mt-1">
                Payment method: <span className="font-semibold">{pendingExpense.payment_method.toUpperCase()}</span> (
                {formatMoney(topUpBalances[pendingExpense.payment_method], settings.currency)} available)
              </p>
              <p className="mt-2 font-semibold">
                Shortfall: {formatMoney(topUpShortfall, settings.currency)}
              </p>
            </div>

            <div>
              <p className="label mb-3">Top up from other payment methods</p>
              <div className="space-y-3">
                {otherMethods.map(({ method, available }) => (
                  <div key={method} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                    <div>
                      <p className="text-sm font-medium capitalize text-slate-900">{method}</p>
                      <p className="text-xs text-slate-500">Available: {formatMoney(available, settings.currency)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        className="input w-28 text-right"
                        type="number"
                        step="0.01"
                        min="0"
                        max={available}
                        value={topUpDeductions[method] || ''}
                        onChange={e => updateTopUpDeduction(method, parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <span className="text-slate-600">Total to deduct from other methods</span>
              <span className="font-semibold text-slate-900">
                {formatMoney(topUpDeductions.cash + topUpDeductions.coin + topUpDeductions.till, settings.currency)}
              </span>
            </div>

            {topUpDeductions.cash + topUpDeductions.coin + topUpDeductions.till < topUpShortfall && (
              <p className="text-xs text-red-600">Total top-up must cover the shortfall of {formatMoney(topUpShortfall, settings.currency)}</p>
            )}
          </form>
        )}
      </Modal>
    </RoleGuard>
  )
}
