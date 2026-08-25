'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, withRetry } from '@/lib/supabase'
import { SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatDateTime, getLocalDateString } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { RoleGuard } from '@/components/RoleGuard'
import { Modal } from '@/components/Modal'
import { Wallet, Coins, CreditCard, DollarSign, TrendingUp, Clock, CheckCircle, RefreshCw } from 'lucide-react'

export default function DrawerPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cash, setCash] = useState('')
  const [coin, setCoin] = useState('')
  const [till, setTill] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; description: string; onConfirm: () => void; cancelLabel?: string; confirmLabel?: string; tone?: 'default' | 'danger' } | null>(null)
  const [history, setHistory] = useState<any[]>([])
  const [balanceId, setBalanceId] = useState<string | null>(null)
  const [expectedTill, setExpectedTill] = useState(0)
  const [expectedCash, setExpectedCash] = useState(0)
  const [expectedCoin, setExpectedCoin] = useState(0)
  const [todaySales, setTodaySales] = useState(0)
  const [openingBalance, setOpeningBalance] = useState<{ cash: number; coin: number; till: number } | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateString())
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
  }, [router])

  useEffect(() => {
    if (user) fetchData(selectedDate)
  }, [user, selectedDate])

  async function fetchData(date = selectedDate) {
    try {
      const { data, error } = await withRetry(async () => await supabase.from('drawer_balances').select('*').eq('date', date).order('updated_at', { ascending: false }))
      if (error) throw error
      let current = data && data.length > 0 ? data[0] : null
      let opening = null

      if (!current) {
        setBalanceId(null)
        setCash('0')
        setCoin('0')
        setTill('0')
        setNote('')

        const prevDate = new Date(date + 'T00:00:00')
        prevDate.setDate(prevDate.getDate() - 1)
        const prevDateStr = getLocalDateString(prevDate)
        const { data: prevData } = await withRetry(async () => await supabase.from('drawer_balances').select('cash, coin, till').eq('date', prevDateStr).is('shift_id', null).order('updated_at', { ascending: false }).limit(1))
        if (prevData && prevData.length > 0) {
          opening = prevData[0]
          setOpeningBalance({ cash: Number(prevData[0].cash || 0), coin: Number(prevData[0].coin || 0), till: Number(prevData[0].till || 0) })
        } else {
          setOpeningBalance(null)
        }
      } else {
        setOpeningBalance(null)
        setBalanceId(current.id)
        setCash(Number(current.cash || 0).toString())
        setCoin(Number(current.coin || 0).toString())
        setTill(Number(current.till || 0).toString())
        setNote(current.note?.toString() || '')
      }

      const { data: logs } = await supabase
        .from('drawer_balance_logs')
        .select('*')
        .eq('date', date)
        .order('created_at', { ascending: false })
        .limit(100)
      setHistory(logs && logs.length > 0 ? logs : data || [])

      const tomorrow = getLocalDateString(new Date(Date.now() + 86400000))
      const { data: salesData } = await supabase
        .from('sales')
        .select('payment_method, total_amount, amount_tendered, change_amount')
        .gte('created_at', `${date}T00:00:00`)
        .lt('created_at', `${tomorrow}T00:00:00`)
        .eq('is_voided', false)

      const salesList = salesData || []
      setTodaySales(salesList.length)

      let till = 0
      let cash = 0
      let coin = 0
      salesList.forEach(sale => {
        const amount = Number(sale.total_amount || 0)
        if (sale.payment_method === 'till') till += amount
        else if (sale.payment_method === 'cash') cash += amount
        else if (sale.payment_method === 'coin') coin += amount
      })
      setExpectedTill(till)
      setExpectedCash(cash)
      setExpectedCoin(coin)

      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load drawer data'
      setError(message)
      toast.error(`❌ ${message}`)
    } finally {
      setLoading(false)
    }
  }

  async function saveBalance() {
    setConfirm({
      title: 'Update drawer balance',
      description: `Are you sure you want to update the drawer balance for ${selectedDate} to ${formatMoney(grandTotal, settings.currency)}? This will overwrite the current balance.`,
      tone: 'danger',
      confirmLabel: 'Update',
      onConfirm: async () => {
        setConfirm(null)
        setSaving(true)
        try {
          const newCash = parseFloat(cash) || 0
          const newCoin = parseFloat(coin) || 0
          const newTill = parseFloat(till) || 0

          const { data: existing } = await supabase
            .from('drawer_balances')
            .select('id, cash, coin, till')
            .eq('date', selectedDate)
            .is('shift_id', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          const previousCash = existing ? Number(existing.cash || 0) : 0
          const previousCoin = existing ? Number(existing.coin || 0) : 0
          const previousTill = existing ? Number(existing.till || 0) : 0
          let drawerBalanceId = existing?.id || balanceId

          if (existing) {
            const { error: updateError } = await supabase.from('drawer_balances').update({
              cash: newCash,
              coin: newCoin,
              till: newTill,
              note: note || null,
              updated_at: new Date().toISOString(),
            }).eq('id', existing.id)
            if (updateError) throw updateError
          } else {
            const { data: inserted, error: insertError } = await supabase.from('drawer_balances').insert({
              date: selectedDate,
              shift_id: null,
              cash: newCash,
              coin: newCoin,
              till: newTill,
              note: note || null,
            }).select('id').single()
            if (insertError) throw insertError
            drawerBalanceId = inserted?.id || null
          }

          await supabase.from('drawer_balance_logs').insert({
            drawer_balance_id: drawerBalanceId,
            date: selectedDate,
            shift_id: null,
            action: 'manual_count',
            cash_before: previousCash,
            coin_before: previousCoin,
            till_before: previousTill,
            cash_after: newCash,
            coin_after: newCoin,
            till_after: newTill,
            cash_delta: newCash - previousCash,
            coin_delta: newCoin - previousCoin,
            till_delta: newTill - previousTill,
            note: note || null,
            user_id: user?.id || null,
          })

          toast.success('✓ Balance saved successfully')
          setError(null)
          window.dispatchEvent(new Event('drawer-update'))
          await fetchData(selectedDate)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to save balance'
          setError(message)
          toast.error(`❌ ${message}`)
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const totalCash = parseFloat(cash) || 0
  const totalCoin = parseFloat(coin) || 0
  const totalTill = parseFloat(till) || 0
  const grandTotal = totalCash + totalCoin + totalTill

  const tillVariance = totalTill - expectedTill
  const cashVariance = totalCash - expectedCash
  const coinVariance = totalCoin - expectedCoin

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>

  return (
    <RoleGuard allowed={['owner']}>
      <div className="space-y-6">
        <PageHeader 
          title="Cash Drawer Management" 
          description="Count and reconcile physical cash, coins, and till" 
          action={
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="input"
              />
              <button onClick={() => fetchData(selectedDate)} className="btn-secondary gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>
            </div>
          }
        />

        {error && (
          <div className="card bg-red-50 border-red-200 p-4 text-red-700 text-sm flex items-center gap-3">
            <div className="w-1 h-1 bg-red-500 rounded-full"></div>
            {error}
          </div>
        )}

        {openingBalance && (
          <div className="card p-4 border border-slate-200 bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Opening Balance</p>
            <p className="text-sm text-slate-600">
              Carried over from previous close: <span className="font-semibold text-slate-900">{formatMoney(openingBalance.cash + openingBalance.coin + openingBalance.till, settings.currency)}</span>
              <span className="text-slate-400 ml-2">({formatMoney(openingBalance.cash, settings.currency)} cash + {formatMoney(openingBalance.coin, settings.currency)} coin + {formatMoney(openingBalance.till, settings.currency)} till)</span>
            </p>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-6 border-l-4 border-l-amber-500 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cash</p>
              <Wallet className="w-5 h-5 text-amber-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{formatMoney(totalCash, settings.currency)}</p>
            <p className="text-xs text-slate-400 mt-2">Paper money</p>
          </div>

          <div className="card p-6 border-l-4 border-l-blue-500 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Coins</p>
              <Coins className="w-5 h-5 text-blue-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{formatMoney(totalCoin, settings.currency)}</p>
            <p className="text-xs text-slate-400 mt-2">Loose change</p>
          </div>

          <div className="card p-6 border-l-4 border-l-emerald-500 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Till</p>
              <CreditCard className="w-5 h-5 text-emerald-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{formatMoney(totalTill, settings.currency)}</p>
            <p className="text-xs text-slate-400 mt-2">Register total</p>
          </div>
        </div>

        {/* Grand Total */}
        <div className="card p-6 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
          <div className="flex items-center justify-between">
            <div>
          <p className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-2">Grand Total</p>
          <p className="text-4xl font-bold">{formatMoney(grandTotal, settings.currency)}</p>
          <p className="text-xs text-slate-400 mt-1">{todaySales} sale{todaySales === 1 ? '' : 's'} on {selectedDate === getLocalDateString() ? 'today' : selectedDate}</p>
            </div>
            <DollarSign className="w-12 h-12 text-slate-700" />
          </div>
        </div>

        {/* Expected vs Actual */}
        <div className="card p-6">
          <h3 className="text-lg font-bold text-slate-900 mb-4">Expected vs Actual</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-200">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Expected Till</p>
              <p className="text-xl font-bold text-slate-900">{formatMoney(expectedTill, settings.currency)}</p>
              <p className={`text-xs font-semibold ${tillVariance === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                Variance: {formatMoney(tillVariance, settings.currency)}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Expected Cash</p>
              <p className="text-xl font-bold text-slate-900">{formatMoney(expectedCash, settings.currency)}</p>
              <p className={`text-xs font-semibold ${cashVariance === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                Variance: {formatMoney(cashVariance, settings.currency)}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Expected Coin</p>
              <p className="text-xl font-bold text-slate-900">{formatMoney(expectedCoin, settings.currency)}</p>
              <p className={`text-xs font-semibold ${coinVariance === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                Variance: {formatMoney(coinVariance, settings.currency)}
              </p>
            </div>
          </div>
        </div>

        {/* Physical Count Form */}
        <div className="card p-8">
          <div className="mb-8">
            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <div className="w-1 h-6 bg-brand-600 rounded-full"></div>
              Physical Count
            </h3>
            <p className="text-sm text-slate-500 mt-2">Enter the actual amount counted for each denomination</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
            {/* Cash Input */}
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-amber-500" />
                  Cash Amount
                </span>
              </label>
              <input 
                type="number" 
                step="0.01" 
                min="0"
                placeholder="0.00"
                className="input w-full text-lg font-semibold border-2 border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100" 
                value={cash} 
                onChange={e => setCash(e.target.value)} 
              />
              <p className="text-xs text-slate-400">Current: {formatMoney(totalCash, settings.currency)}</p>
            </div>

            {/* Coin Input */}
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-2 mb-2">
                  <Coins className="w-4 h-4 text-blue-500" />
                  Coins Amount
                </span>
              </label>
              <input 
                type="number" 
                step="0.01" 
                min="0"
                placeholder="0.00"
                className="input w-full text-lg font-semibold border-2 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" 
                value={coin} 
                onChange={e => setCoin(e.target.value)} 
              />
              <p className="text-xs text-slate-400">Current: {formatMoney(totalCoin, settings.currency)}</p>
            </div>

            {/* Till Input */}
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-2 mb-2">
                  <CreditCard className="w-4 h-4 text-emerald-500" />
                  Till Amount
                </span>
              </label>
              <input 
                type="number" 
                step="0.01" 
                min="0"
                placeholder="0.00"
                className="input w-full text-lg font-semibold border-2 border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" 
                value={till} 
                onChange={e => setTill(e.target.value)} 
              />
              <p className="text-xs text-slate-400">Current: {formatMoney(totalTill, settings.currency)}</p>
            </div>
          </div>

          {/* Note Field */}
          <div className="mb-6 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2 block">Note (Optional)</span>
              <textarea 
                rows={2} 
                placeholder="Add any notes about this count (e.g., discrepancies, missing bills, etc.)"
                className="input w-full border-2 border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 resize-none" 
                value={note} 
                onChange={e => setNote(e.target.value)} 
              />
            </label>
          </div>

          {/* Save Button */}
          <button 
            onClick={saveBalance} 
            disabled={saving}
            className="btn-primary w-full py-4 text-lg font-semibold flex items-center justify-center gap-2 hover:shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Save Balance ({formatMoney(grandTotal, settings.currency)})
              </>
            )}
          </button>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="card p-8">
            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2 mb-6">
              <Clock className="w-5 h-5 text-slate-400" />
              {selectedDate === getLocalDateString() ? 'Today' : selectedDate}&apos;s History
            </h3>
            
            <div className="space-y-3">
              {history.map((h, idx) => {
                const hCash = Number(h.cash_after ?? h.cash ?? 0)
                const hCoin = Number(h.coin_after ?? h.coin ?? 0)
                const hTill = Number(h.till_after ?? h.till ?? 0)
                const hTotal = hCash + hCoin + hTill
                const cashDelta = Number(h.cash_delta || 0)
                const coinDelta = Number(h.coin_delta || 0)
                const tillDelta = Number(h.till_delta || 0)
                return (
                  <div key={h.id} className="grid grid-cols-1 sm:grid-cols-5 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200 hover:border-slate-300 transition-all hover:shadow-sm">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Time</p>
                      <p className="font-medium text-slate-900">{formatDateTime(h.created_at || h.updated_at)}</p>
                      {h.action && <p className="text-xs text-slate-400 capitalize">{String(h.action).replace('_', ' ')}</p>}
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Wallet className="w-3 h-3 text-amber-600" />Cash
                      </p>
                      <p className="font-medium text-slate-900">{formatMoney(hCash, settings.currency)}</p>
                      {cashDelta !== 0 && <p className="text-xs text-slate-400">{cashDelta > 0 ? '+' : ''}{formatMoney(cashDelta, settings.currency)}</p>}
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Coins className="w-3 h-3 text-blue-600" />Coins
                      </p>
                      <p className="font-medium text-slate-900">{formatMoney(hCoin, settings.currency)}</p>
                      {coinDelta !== 0 && <p className="text-xs text-slate-400">{coinDelta > 0 ? '+' : ''}{formatMoney(coinDelta, settings.currency)}</p>}
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <CreditCard className="w-3 h-3 text-emerald-600" />Till
                      </p>
                      <p className="font-medium text-slate-900">{formatMoney(hTill, settings.currency)}</p>
                      {tillDelta !== 0 && <p className="text-xs text-slate-400">{tillDelta > 0 ? '+' : ''}{formatMoney(tillDelta, settings.currency)}</p>}
                    </div>
                    <div className="border-l border-slate-200 pl-4">
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total</p>
                      <p className="text-lg font-bold text-slate-900">{formatMoney(hTotal, settings.currency)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
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
