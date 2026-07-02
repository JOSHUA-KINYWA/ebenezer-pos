'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatDateTime } from '@/lib/format'
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
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase.from('drawer_balances').select('*').eq('date', today).order('updated_at', { ascending: false })
      if (error) throw error
      const current = data && data.length > 0 ? data[0] : null
      if (current) {
        setCash(current.cash?.toString() || '0')
        setCoin(current.coin?.toString() || '0')
        setTill(current.till?.toString() || '0')
        setNote(current.note?.toString() || '')
      }
      setHistory(data || [])
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
      description: `Are you sure you want to update the drawer balance to ${formatMoney(grandTotal, settings.currency)}? This will overwrite the current balance.`,
      tone: 'danger',
      confirmLabel: 'Update',
      onConfirm: async () => {
        setConfirm(null)
        setSaving(true)
        try {
          const today = new Date().toISOString().split('T')[0]
          const newCash = parseFloat(cash) || 0
          const newCoin = parseFloat(coin) || 0
          const newTill = parseFloat(till) || 0

          const { data: existing } = await supabase
            .from('drawer_balances')
            .select('id, cash, coin, till')
            .eq('date', today)
            .is('shift_id', null)
            .maybeSingle()

          if (existing) {
            await supabase.from('drawer_balances').update({
              cash: newCash,
              coin: newCoin,
              till: newTill,
              note: note || null,
              updated_at: new Date().toISOString(),
            }).eq('id', existing.id)
          } else {
            await supabase.from('drawer_balances').insert({
              date: today,
              shift_id: null,
              cash: newCash,
              coin: newCoin,
              till: newTill,
              note: note || null,
            })
          }

          toast.success('✓ Balance saved successfully')
          setError(null)
          window.dispatchEvent(new Event('drawer-update'))
          await fetchData()
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

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>

  return (
    <RoleGuard allowed={['owner', 'cashier']}>
      <div className="space-y-6">
        <PageHeader 
          title="Cash Drawer Management" 
          description="Count and reconcile physical cash, coins, and till" 
          action={<button onClick={fetchData} className="btn-secondary gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>} 
        />

        {error && (
          <div className="card bg-red-50 border-red-200 p-4 text-red-700 text-sm flex items-center gap-3">
            <div className="w-1 h-1 bg-red-500 rounded-full"></div>
            {error}
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
            </div>
            <DollarSign className="w-12 h-12 text-slate-700" />
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
              Today's History
            </h3>
            
            <div className="space-y-3">
              {history.map((h, idx) => {
                const hTotal = (h.cash || 0) + (h.coin || 0) + (h.till || 0)
                return (
                  <div key={h.id} className="grid grid-cols-1 sm:grid-cols-5 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200 hover:border-slate-300 transition-all hover:shadow-sm">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Time</p>
                      <p className="font-medium text-slate-900">{formatDateTime(h.updated_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Wallet className="w-3 h-3 text-amber-600" />Cash
                      </p>
                      <p className="font-medium text-slate-900">{formatMoney(h.cash || 0, settings.currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Coins className="w-3 h-3 text-blue-600" />Coins
                      </p>
                      <p className="font-medium text-slate-900">{formatMoney(h.coin || 0, settings.currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <CreditCard className="w-3 h-3 text-emerald-600" />Till
                      </p>
                      <p className="font-medium text-slate-900">{formatMoney(h.till || 0, settings.currency)}</p>
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