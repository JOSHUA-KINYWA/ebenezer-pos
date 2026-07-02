'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { CartItem, Customer, Product, SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatProductName } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/PageHeader'
import { CheckCircle, Plus, Minus, X, ArrowLeftRight, Search } from 'lucide-react'

type POSPaymentType = 'cash'
type CashMethod = 'cash' | 'coin' | 'till'

const CART_STORAGE_KEY = 'ebenezar-pos-cart'

export default function SellPage() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [cart, setCart] = useState<CartItem[]>([])
  const [tierSelectionProduct, setTierSelectionProduct] = useState<Product | null>(null)
  const [paymentType, setPaymentType] = useState<POSPaymentType>('cash')
  const [paymentMethod, setPaymentMethod] = useState<CashMethod>('cash')
  const [isReviewingPayment, setIsReviewingPayment] = useState(false)
  const [customer, setCustomer] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [completedSale, setCompletedSale] = useState<{ id: string; total: number; items: CartItem[]; customer: string } | null>(null)
  const [cartHighlight, setCartHighlight] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; description: string; onConfirm: () => void; cancelLabel?: string; confirmLabel?: string; tone?: 'default' | 'danger' } | null>(null)
  const cartRef = useRef<HTMLDivElement | null>(null)

  const supabase = createClient()
  const { settings } = useShopSettings()
  const toast = useToast()

  useEffect(() => {
    const currentSession = getSession()
    setUser(currentSession)
    if (currentSession) {
      fetchProducts()
    } else {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = window.localStorage.getItem(CART_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as CartItem[]
        if (Array.isArray(parsed)) {
          setCart(parsed)
        }
      }
    } catch (error) {
      console.error('Unable to load cart state', error)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart))
    window.dispatchEvent(
      new CustomEvent('ebenezar-pos-cart-updated', {
        detail: { count: cart.reduce((sum, item) => sum + item.quantity, 0) },
      })
    )
  }, [cart])

  async function fetchProducts() {
    const [{ data: productData }, { data: customerData }] = await Promise.all([
      supabase.from('products').select('*, category:categories(name)').eq('is_active', true).order('name'),
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
    ])

    setProducts(productData ?? [])
    setCustomers(customerData ?? [])
    setLoading(false)
  }

  const parentProducts = useMemo(
    () => products.filter(product => !product.parent_product_id),
    [products]
  )

  const categories = useMemo(
    () => Array.from(new Set(parentProducts.map(product => (product.category as { name?: string })?.name ?? 'Uncategorized'))),
    [parentProducts]
  )

  function getProductVariants(productId: string) {
    return products.filter(p => p.parent_product_id === productId && p.is_active)
  }

  function isProductOutOfStock(product: Product): boolean {
    const variants = getProductVariants(product.id)
    if (variants.length > 0) {
      return getAggregateStock(product) === 0
    }
    return Number(product.stock_qty || 0) === 0
  }

  function getPricingTiers(product: Product) {
    const tiers = (product as any).pricing_tiers || []
    return Array.isArray(tiers) ? tiers.filter((t: any) => t && t.qty && t.price) : []
  }

  function getAggregateStock(product: Product): number {
    if (product.parent_product_id) return product.stock_qty
    const variants = getProductVariants(product.id)
    if (variants.length === 0) return product.stock_qty
    return variants.reduce((sum, v) => sum + Number(v.stock_qty || 0), 0)
  }

  const filteredParentProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return parentProducts.filter(product => {
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        (product.variety ?? '').toLowerCase().includes(query)
      const matchesCategory =
        categoryFilter === 'all' ||
        ((product.category as { name?: string })?.name ?? 'Uncategorized') === categoryFilter
      return matchesSearch && matchesCategory
    })
  }, [parentProducts, search, categoryFilter])

  function addToCart(product: Product, tier?: { qty: number; price: number }) {
    if (product.stock_qty === 0 && !tier) {
      toast.error(`⚠️ ${formatProductName(product)} is out of stock!`)
      return
    }

    const tiers = (product as any).pricing_tiers || []
    const validTiers = Array.isArray(tiers) ? tiers.filter((t: any) => t && t.qty && t.price) : []
    const selectedTier = tier || (validTiers.length === 1 ? { qty: validTiers[0].qty, price: validTiers[0].price } : undefined)

    const quantity = selectedTier ? selectedTier.qty : 1
    const subtotal = selectedTier ? selectedTier.price : product.price
    const effectiveStock = selectedTier ? product.stock_qty : product.stock_qty

    if (effectiveStock < quantity && !tier) {
      toast.error(`⚠️ ${formatProductName(product)} only has ${product.stock_qty} available`)
      return
    }

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id)
      const next = existing
        ? prev.map(item =>
            item.product.id === product.id
              ? { ...item, quantity: item.quantity + quantity, subtotal: item.subtotal + subtotal, saleMode: (item.saleMode ?? 'quantity') as 'quantity' | 'amount', selectedTier: item.selectedTier || selectedTier }
              : item
          )
        : [...prev, { product, quantity, subtotal, saleMode: 'amount' as const, selectedTier }]

      if (existing) {
        toast.info(`Added another ${formatProductName(product)}`)
      } else {
        toast.success(`✓ ${formatProductName(product)} added to cart`)
      }
      setCartHighlight(true)
      setTimeout(() => {
        setCartHighlight(false)
      }, 1400)
      setTimeout(() => {
        cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 0)

      return next
    })
  }

  function handleProductSelect(product: Product) {
    const tiers = (product as any).pricing_tiers || []
    const validTiers = Array.isArray(tiers) ? tiers.filter((t: any) => t && t.qty && t.price) : []

    if (validTiers.length > 1) {
      setTierSelectionProduct(product)
      return
    }

    addToCart(product)
  }

  function isDecimalUnit(unit: string): boolean {
    const decimalUnits = ['liter', 'litre', 'ml', 'gram', 'kg', 'oz', 'lb', 'gallon', 'pint', 'cup', 'tbsp', 'tsp', 'meter', 'm', 'cm', 'km']
    return decimalUnits.some(u => unit.toLowerCase().includes(u))
  }

  function getIncrementStep(unit: string): number {
    return isDecimalUnit(unit) ? 0.5 : 1
  }

  function formatQtyDisplay(qty: number, unit: string): string {
    return isDecimalUnit(unit) ? qty.toFixed(2) : qty.toString()
  }

  function recalculateCartItem(item: CartItem, qty?: number, amount?: number): CartItem {
    const tier = item.selectedTier
    if (tier) {
      if (amount !== undefined && amount >= 0) {
        const tierMultiples = Math.max(1, Math.round((amount || 0) / tier.price))
        const newQty = tierMultiples * tier.qty
        const newSubtotal = tierMultiples * tier.price
        return { ...item, quantity: newQty, subtotal: Math.round(newSubtotal * 100) / 100 }
      }
      const targetQty = qty ?? item.quantity
      const tierMultiples = Math.max(1, Math.round(targetQty / tier.qty))
      const newQty = tierMultiples * tier.qty
      const subtotal = tierMultiples * tier.price
      return { ...item, quantity: newQty, subtotal: Math.round(subtotal * 100) / 100 }
    }

    const finalQty = Math.round((qty ?? item.quantity) * 100) / 100
    const finalSubtotal = Math.round((amount ?? item.subtotal) * 100) / 100
    return { ...item, quantity: finalQty, subtotal: finalSubtotal }
  }

  function updateQty(productId: string, qty: number) {
    const cartItem = cart.find(item => item.product.id === productId)
    if (!cartItem) return

    const isDecimal = isDecimalUnit(cartItem.product.unit)
    const validQty = Math.max(0.01, isNaN(qty) ? 0.01 : qty)
    const finalQty = isDecimal ? Math.round(validQty * 100) / 100 : Math.round(validQty)

    setCart(prev =>
      prev.map(item =>
        item.product.id === productId
          ? recalculateCartItem(item, finalQty)
          : item
      )
    )
  }

  function increaseQty(productId: string) {
    const cartItem = cart.find(item => item.product.id === productId)
    if (!cartItem) return

    const step = getIncrementStep(cartItem.product.unit)
    const newQty = cartItem.quantity + step

    setCart(prev =>
      prev.map(item =>
        item.product.id === productId
          ? recalculateCartItem(item, newQty)
          : item
      )
    )
  }

  function decreaseQty(productId: string) {
    const cartItem = cart.find(item => item.product.id === productId)
    if (!cartItem) return

    const step = getIncrementStep(cartItem.product.unit)
    const newQty = Math.max(0.01, cartItem.quantity - step)

    setCart(prev =>
      prev.map(item =>
        item.product.id === productId
          ? recalculateCartItem(item, newQty)
          : item
      )
    )
  }

  function setCartItemMode(productId: string, saleMode: 'quantity' | 'amount') {
    setCart(prev =>
      prev.map(item => {
        if (item.product.id !== productId) return item

        if (saleMode === 'quantity') {
          const quantity = Math.max(0.01, item.quantity || 1)
          return recalculateCartItem(item, quantity)
        }

        const amount = Math.max(0.01, item.subtotal || item.product.price)
        if (item.selectedTier) {
          const tierMultiples = Math.max(1, Math.round(amount / item.selectedTier.price))
          const quantity = tierMultiples * item.selectedTier.qty
          const subtotal = tierMultiples * item.selectedTier.price
          return { ...item, saleMode, quantity, subtotal: Math.round(subtotal * 100) / 100 }
        }

        const quantity = item.product.price > 0 ? Math.round((amount / item.product.price) * 100) / 100 : 0
        return { ...item, saleMode, quantity, subtotal: Math.round(amount * 100) / 100 }
      })
    )
  }

  function removeFromCart(productId: string) {
    const product = cart.find(item => item.product.id === productId)?.product
    setCart(prev => prev.filter(item => item.product.id !== productId))
    if (product) {
      toast.info(`✕ ${formatProductName(product)} removed from cart`)
    }
  }

  function updateAmount(productId: string, amount: number) {
    if (amount < 0) return
    setCart(prev =>
      prev.map(item => {
        if (item.product.id !== productId) return item
        return recalculateCartItem(item, undefined, amount)
      })
    )
  }

  async function rollbackSale(saleId: string, items: CartItem[], userId?: string) {
    try {
      await supabase.from('sales').delete().eq('id', saleId)
      await Promise.all(
        items.map(async item => {
          const { data: product, error: productError } = await supabase.from('products').select('stock_qty').eq('id', item.product.id).single()
          if (productError || !product) return

          const nextStock = Number(product.stock_qty) + Number(item.quantity)
          await supabase.from('products').update({ stock_qty: nextStock }).eq('id', item.product.id)
          await supabase.from('stock_log').insert({
            product_id: item.product.id,
            user_id: userId ?? null,
            change_qty: Number(item.quantity),
            reason: 'adjustment',
            note: `Rollback sale ${saleId.slice(0, 8).toUpperCase()}`,
          })
        })
      )
    } catch (error) {
      console.error('Failed to rollback sale:', error)
    }
  }

  async function completeSale() {
    if (!user) {
      toast.error('❌ Session expired — please sign in again.')
      return
    }

    if (cart.length === 0) {
      toast.error('❌ Cart is empty. Add products before completing the sale.')
      return
    }

    const totalAmount = cart.reduce((sum, item) => sum + item.subtotal, 0)
    
    if (totalAmount > 50000) {
      setConfirm({
        title: 'Large transaction',
        description: `Large transaction detected (${formatMoney(totalAmount, settings.currency)}). Are you sure?`,
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        tone: 'danger',
        onConfirm: async () => {
          setConfirm(null)
          await processCompletion(totalAmount)
        },
      })
      return
    }

    await processCompletion(totalAmount)
  }

  async function processCompletion(totalAmount: number) {

    const stockChecks = await Promise.all(
      cart.map(async item => {
        const { data: product, error } = await supabase.from('products').select('id, stock_qty').eq('id', item.product.id).single()
        if (error || !product) throw new Error(`Unable to verify stock for ${formatProductName(item.product)}`)
        if (Number(product.stock_qty) < item.quantity) {
          throw new Error(`${formatProductName(item.product)} only has ${product.stock_qty} available`)
        }
        return product
      })
    )

    if (!stockChecks.length) {
      toast.error('❌ No items available for sale')
      setSubmitting(false)
      return
    }

    try {
      const { data: sale, error: saleErr } = await supabase
        .from('sales')
        .insert({
          user_id: user!.id,
          shift_id: null,
          customer_id: customerId || null,
          subtotal: totalAmount,
          tax_amount: 0,
          total_amount: totalAmount,
          payment_type: 'cash',
          payment_method: paymentMethod,
          discount: 0,
          mpesa_ref: null,
          card_ref: null,
          amount_tendered: totalAmount,
          change_amount: 0,
          note: customer ? `Customer: ${customer}` : null,
        })
        .select('id')
        .single()

      if (saleErr || !sale) {
        throw new Error(saleErr?.message ?? 'Failed to record sale')
      }

      const saleItems = cart.map(item => ({
        sale_id: sale.id,
        product_id: item.product.id,
        product_name: formatProductName(item.product),
        quantity: item.quantity,
        unit_price: item.selectedTier ? item.selectedTier.price : item.product.price,
        subtotal: item.subtotal,
      }))

      const { error: itemsErr } = await supabase.from('sale_items').insert(saleItems)
      if (itemsErr) {
        throw new Error(itemsErr.message)
      }

      const preSaleStock = new Map<string, number>()
      stockChecks.forEach((product: any) => {
        preSaleStock.set(product.id, Number(product.stock_qty))
      })

      const stockAdjustments = await Promise.all(
        cart.map(async item => {
          const { data: product, error } = await supabase.from('products').select('stock_qty').eq('id', item.product.id).single()
          if (error || !product) return null
          const expected = Math.max(0, (preSaleStock.get(item.product.id) ?? Number(product.stock_qty)) - item.quantity)
          if (Number(product.stock_qty) !== expected) {
            const { error: updateErr } = await supabase.from('products').update({ stock_qty: expected }).eq('id', item.product.id)
            if (updateErr) console.error('Stock adjust failed', item.product.id, updateErr)
          }
          return { productId: item.product.id, name: item.product.name, deducted: item.quantity, nextStock: expected }
        })
      )

      console.log('Sale completed', {
        cart,
        saleItems,
        stockAdjustments,
        preSaleStock: Object.fromEntries(preSaleStock),
      })

      if (stockAdjustments.some(item => item && item.deducted > 0 && Number(item.nextStock) !== (preSaleStock.get(item.productId) ?? 0) - item.deducted)) {
        console.warn('Stock adjustments applied after sale:', stockAdjustments)
      }

      if (paymentType === 'cash') {
        const today = new Date().toISOString().split('T')[0]
        const { data: existing } = await supabase
          .from('drawer_balances')
          .select('id, cash, coin, till')
          .eq('date', today)
          .is('shift_id', null)
          .maybeSingle()

        if (existing) {
          const nextCash = Number(existing.cash || 0) + (paymentMethod === 'cash' ? totalAmount : 0)
          const nextCoin = Number(existing.coin || 0) + (paymentMethod === 'coin' ? totalAmount : 0)
          const nextTill = Number(existing.till || 0) + (paymentMethod === 'till' ? totalAmount : 0)
          const { error: drawerError } = await supabase
            .from('drawer_balances')
            .update({ cash: nextCash, coin: nextCoin, till: nextTill, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
          if (drawerError) throw new Error(drawerError.message)
        } else {
          const { error: drawerError } = await supabase.from('drawer_balances').insert({
            date: today,
            shift_id: null,
            cash: paymentMethod === 'cash' ? totalAmount : 0,
            coin: paymentMethod === 'coin' ? totalAmount : 0,
            till: paymentMethod === 'till' ? totalAmount : 0,
          })
          if (drawerError) throw new Error(drawerError.message)
        }
      }

      await fetchProducts()

      window.dispatchEvent(new Event('drawer-update'))

      setCompletedSale({ id: sale.id, total: totalAmount, items: cart, customer })
      setCart([])
      setCustomer('')
      setPaymentType('cash')
      setPaymentMethod('cash')
      setIsReviewingPayment(false)
      setSubmitting(false)
      toast.success(`✓ Sale completed! Receipt #${sale.id.slice(0, 8).toUpperCase()} for ${formatMoney(totalAmount, settings.currency)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to complete sale'
      toast.error(`❌ ${message}`)
      setSubmitting(false)
    }
  }

  function startNewSale() {
    setCompletedSale(null)
    setIsReviewingPayment(false)
    setCart([])
    setCustomer('')
    setPaymentType('cash')
    setPaymentMethod('cash')
    cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading) return <LoadingSpinner label="Loading products..." />

  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
  const total = subtotal
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div>
      <PageHeader title="Point of Sale" description="Record sales transactions" />

      {isReviewingPayment ? (
        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex items-center justify-between gap-3 mb-6">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Payment Review</h2>
                <p className="text-sm text-slate-500">Confirm the order details before completing payment.</p>
              </div>
              <button type="button" onClick={() => setIsReviewingPayment(false)} className="btn-secondary text-sm px-4 py-2">
                Back to sale
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">Order Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Items</span>
                    <span>{cart.length}</span>
                  </div>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Customer</span>
                    <span>{customer || 'Walk-in'}</span>
                  </div>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">Select customer</span>
                    <select
                      value={customerId}
                      onChange={e => {
                        const selected = customers.find(item => item.id === e.target.value)
                        setCustomerId(e.target.value)
                        setCustomer(selected?.name || '')
                      }}
                      className="input w-full"
                    >
                      <option value="">Walk-in</option>
                      {customers.map(item => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Payment type</span>
                    <span className="capitalize">{paymentType}</span>
                  </div>
                  {paymentType === 'cash' && (
                    <div className="flex justify-between text-sm text-slate-600">
                      <span>Cash method</span>
                      <span className="capitalize">{paymentMethod}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
                <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">Order Items (Edit quantities or amounts)</h3>
                <div className="max-h-64 overflow-y-auto space-y-3 mb-4 pr-2">
                  {cart.map(item => (
                    <div key={item.product.id} className="border border-slate-200 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1">
                          <p className="font-medium text-xs">{formatProductName(item.product)}</p>
                          <p className="text-xs text-slate-500">
                            {item.selectedTier
                              ? `${item.selectedTier.qty} for ${formatMoney(item.selectedTier.price, settings.currency)}`
                              : `${formatMoney(item.product.price, settings.currency)} each`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product.id)}
                          className="text-slate-400 hover:text-red-600 transition-colors p-1"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 p-0.5">
                            <button
                              type="button"
                              onClick={() => setCartItemMode(item.product.id, 'quantity')}
                              className={`rounded-full px-2 py-1 text-[11px] font-medium ${item.saleMode !== 'amount' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
                            >
                              Qty
                            </button>
                            <button
                              type="button"
                              onClick={() => setCartItemMode(item.product.id, 'amount')}
                              className={`rounded-full px-2 py-1 text-[11px] font-medium ${item.saleMode === 'amount' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
                            >
                              Amount
                            </button>
                          </div>

                          {item.saleMode !== 'amount' ? (
                            <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5">
                              <button
                                type="button"
                                onClick={() => decreaseQty(item.product.id)}
                                disabled={item.quantity <= 0.01}
                                className="p-1 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed rounded"
                              >
                                <Minus className="w-3 h-3 text-slate-600" />
                              </button>
                              <input
                                type="number"
                                min="0.01"
                                step={isDecimalUnit(item.product.unit) ? '0.5' : '1'}
                                value={formatQtyDisplay(item.quantity, item.product.unit)}
                                onChange={e => updateQty(item.product.id, Number(e.target.value) || 0.01)}
                                className="input w-12 text-center border-0 p-0.5 text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => increaseQty(item.product.id)}
                                className="p-1 hover:bg-slate-100 rounded"
                              >
                                <Plus className="w-3 h-3 text-slate-600" />
                              </button>
                            </div>
                          ) : (
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={item.subtotal.toFixed(2)}
                              onChange={e => updateAmount(item.product.id, Math.max(0.01, Number(e.target.value) || 0))}
                              className="input w-24 text-right p-1 text-xs"
                              placeholder="0.00"
                            />
                          )}
                        </div>
                        <span className="font-semibold text-slate-900 min-w-fit">{formatMoney(item.subtotal, settings.currency)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">Payment Method</h3>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['cash', 'coin', 'till'] as CashMethod[]).map(method => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium capitalize ${paymentMethod === method ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">Totals</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Subtotal</span>
                    <span>{formatMoney(subtotal, settings.currency)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-semibold text-slate-900">
                    <span>Total</span>
                    <span>{formatMoney(total, settings.currency)}</span>
                  </div>
                </div>
                <div className="mt-6 space-y-4">
                  <button
                    type="button"
                    onClick={completeSale}
                    disabled={submitting}
                    className="btn-primary w-full py-3"
                  >
                    {submitting ? 'Processing payment...' : 'Confirm payment'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsReviewingPayment(false)}
                    className="btn-secondary w-full py-3"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Sell products</h2>
                <p className="text-sm text-slate-500">Search, scan, and select a variant under each main product.</p>
              </div>

            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input pl-9 w-full"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`btn-sm rounded-full ${categoryFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                All categories
              </button>
              {categories.map(category => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setCategoryFilter(category)}
                  className={`btn-sm rounded-full ${categoryFilter === category ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[560px] overflow-y-auto pr-1">
            {filteredParentProducts.length === 0 ? (
              <div className="card p-6 col-span-full text-center text-sm text-slate-500">
                No products match this filter.
              </div>
            ) : (
              filteredParentProducts.map(product => {
                const variants = getProductVariants(product.id)
                const hasVariants = variants.length > 0
                const outOfStock = isProductOutOfStock(product)
                return (
                  <div key={product.id} className={`card p-4 transition-shadow ${outOfStock ? 'opacity-60 border-slate-200' : 'hover:shadow-lg'}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-semibold text-slate-900">{formatProductName(product)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${outOfStock ? 'bg-red-100 text-red-700' : hasVariants ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {outOfStock ? 'Out of stock' : hasVariants ? `${variants.length} variant${variants.length === 1 ? '' : 's'}` : 'Product'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">{(product.category as { name?: string })?.name || 'Uncategorized'}</p>
                    <div className="grid gap-2 text-sm text-slate-600 mb-3">
                      <div className="flex items-center justify-between">
                        <span>Price</span>
                        <span className="font-semibold text-slate-900">{formatMoney(product.price, settings.currency)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Stock</span>
                        <span className="font-semibold text-slate-900">
                          {hasVariants ? getAggregateStock(product).toLocaleString() : `${product.stock_qty} ${product.unit}`}
                        </span>
                      </div>
                    </div>

                    {hasVariants && (
                      <div className="mb-3">
                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Variants</p>
                        <div className="flex flex-wrap gap-2">
                          {variants.map(variant => {
                            const variantOutOfStock = Number(variant.stock_qty || 0) === 0
                            return (
                              <button
                                key={variant.id}
                                type="button"
                                onClick={() => !variantOutOfStock && addToCart(variant)}
                                disabled={variantOutOfStock}
                                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                                  variantOutOfStock
                                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400 hover:text-brand-700'
                                }`}
                              >
                                <Plus className="w-3 h-3" />
                                {formatProductName(variant)}
                                <span className="text-slate-400">({formatMoney(variant.price, settings.currency)})</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {!hasVariants && (() => {
                      const tiers = getPricingTiers(product)
                      if (tiers.length > 1) {
                        return (
                          <div className="mb-3">
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Pricing tiers</p>
                            <div className="flex flex-wrap gap-2">
                              {tiers.map((tier: any, idx: number) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => addToCart(product, { qty: Number(tier.qty), price: Number(tier.price) })}
                                  disabled={outOfStock}
                                  className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                                    outOfStock
                                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400 hover:text-brand-700'
                                  }`}
                                >
                                  <Plus className="w-3 h-3" />
                                  {tier.qty} for {formatMoney(Number(tier.price), settings.currency)}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      }
                      return (
                        <button
                          type="button"
                          onClick={() => addToCart(product)}
                          disabled={outOfStock}
                          className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            outOfStock
                              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                              : 'bg-brand-600 text-white hover:bg-brand-700'
                          }`}
                        >
                          <Plus className="w-4 h-4" />
                          Add to cart
                        </button>
                      )
                    })()}
                  </div>
                )
              })
            )}
          </div>

          <div
            ref={cartRef}
            className={`card p-4 transition-all duration-300 ${cartHighlight ? 'border-brand-500 ring-2 ring-brand-200 shadow-lg' : 'border-slate-200'}`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Current cart</h2>
                <p className="text-sm text-slate-500">
                  {cart.length > 0
                    ? `${cartItemsCount} unit${cartItemsCount === 1 ? '' : 's'} across ${cart.length} item${cart.length === 1 ? '' : 's'}`
                    : 'Add products from the catalog to build a sale.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCart([])
                      toast.info('🧹 Cart cleared')
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    Clear cart
                  </button>
                )}
                {cart.length > 0 && (
                  <button type="button" onClick={() => setIsReviewingPayment(true)} className="btn-primary px-4 py-2">
                    Review payment
                  </button>
                )}
              </div>
            </div>

            {cart.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No items in the cart yet. Tap any product to add it and keep building the sale.
              </div>
            ) : (
              <div className="space-y-4">
                {cart.map(item => (
                  <div key={item.product.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-slate-900">{formatProductName(item.product)}</p>
                        <p className="text-xs text-slate-500">
                          {item.selectedTier
                            ? `${item.selectedTier.qty} for ${formatMoney(item.selectedTier.price, settings.currency)}`
                            : `${formatMoney(item.product.price, settings.currency)} per unit`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.product.id)}
                        className="rounded-full p-1.5 text-slate-400 transition hover:bg-white hover:text-red-600"
                        title="Remove from cart"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                        <button
                          type="button"
                          onClick={() => setCartItemMode(item.product.id, 'quantity')}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                            item.saleMode !== 'amount'
                              ? 'bg-brand-600 text-white shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Qty
                        </button>
                        <button
                          type="button"
                          onClick={() => setCartItemMode(item.product.id, 'amount')}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                            item.saleMode === 'amount'
                              ? 'bg-brand-600 text-white shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Amount
                        </button>
                      </div>

                      {item.saleMode === 'amount' ? (
                        <div className="flex-1 flex items-center gap-2">
                          <span className="text-xs text-slate-500 whitespace-nowrap">KSh</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.subtotal.toFixed(2)}
                            onChange={e => updateAmount(item.product.id, Math.max(0.01, Number(e.target.value) || 0))}
                            className="input flex-1 text-right font-semibold"
                            placeholder="0.00"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1">
                          <button
                            type="button"
                            onClick={() => decreaseQty(item.product.id)}
                            disabled={item.quantity <= 1}
                            className="rounded p-1.5 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Decrease quantity"
                          >
                            <Minus className="w-4 h-4 text-slate-600" />
                          </button>
                          <input
                            type="number"
                            min="1"
                            step={isDecimalUnit(item.product.unit) ? '0.5' : '1'}
                            value={formatQtyDisplay(item.quantity, item.product.unit)}
                            onChange={e => updateQty(item.product.id, Number(e.target.value) || 1)}
                            className="input w-12 border-0 bg-transparent p-1 text-center"
                          />
                          <button
                            type="button"
                            onClick={() => increaseQty(item.product.id)}
                            className="rounded p-1.5 hover:bg-slate-100"
                            title="Increase quantity"
                          >
                            <Plus className="w-4 h-4 text-slate-600" />
                          </button>
                        </div>
                      )}

                      <span className="text-sm font-bold text-slate-900 whitespace-nowrap min-w-fit w-20 text-right">
                        {formatMoney(item.subtotal, settings.currency)}
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  <span className="font-semibold">Total due</span>
                  <span className="font-semibold text-slate-900">{formatMoney(total, settings.currency)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{cartItemsCount} item{cartItemsCount === 1 ? '' : 's'}</p>
              <p className="text-xs text-slate-500">{formatMoney(total, settings.currency)}</p>
            </div>
            <button type="button" onClick={() => setIsReviewingPayment(true)} className="btn-primary px-4 py-2">
              Checkout
            </button>
          </div>
        </div>
      )}

      {completedSale && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card w-full max-w-md mx-4 p-6 text-center">
            <CheckCircle className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-900 mb-2">Sale Complete!</h3>
            <p className="text-slate-600 mb-4">Sale #{completedSale.id} for {formatMoney(completedSale.total, settings.currency)}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setCompletedSale(null); window.print() }} className="btn-secondary flex-1">Print</button>
              <button type="button" onClick={startNewSale} className="btn-primary flex-1">New Sale</button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  )
}
