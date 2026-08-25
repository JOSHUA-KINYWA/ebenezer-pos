'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { CartItem, Customer, Product, PricingTier, SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatProductName, getLocalDateString } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { CheckCircle, Search, Plus, Minus, X, ArrowLeftRight } from 'lucide-react'

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
  const [paymentType, setPaymentType] = useState<POSPaymentType>('cash')
  const [paymentMethod, setPaymentMethod] = useState<CashMethod>('cash')
  const [isReviewingPayment, setIsReviewingPayment] = useState(false)
  const [customer, setCustomer] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [completedSale, setCompletedSale] = useState<{ id: string; total: number; items: CartItem[]; customer: string } | null>(null)
  const [cartHighlight, setCartHighlight] = useState(false)
  const [cartMismatchWarning, setCartMismatchWarning] = useState<string | null>(null)
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

  useEffect(() => {
    if (cart.length === 0 || products.length === 0) return
    setCart(prev =>
      prev.map(item => {
        const updated = products.find(p => p.id === item.product.id)
        if (!updated) return item
        const newUnitPrice = getEffectiveUnitPrice(updated)
        const oldUnitPrice = getEffectiveUnitPrice(item.product)
        if (oldUnitPrice === newUnitPrice && updated.cost_price === item.product.cost_price && updated.stock_qty === item.product.stock_qty) {
          return item
        }
        return {
          ...item,
          product: updated,
          subtotal: item.saleMode === 'amount' ? item.subtotal : Math.round(item.quantity * newUnitPrice * 100) / 100,
        }
      })
    )
  }, [products, cart.length])

  useEffect(() => {
    if (cart.length === 0) {
      setCartMismatchWarning(null)
      return
    }

    const mismatched = cart.filter(item => {
      const price = getEffectiveUnitPrice(item.product)
      if (price <= 0) return false
      const expected = Math.round(item.quantity * price * 100) / 100
      return Math.abs(expected - item.subtotal) > 0.01
    })

    if (mismatched.length > 0) {
      const names = mismatched.map(i => formatProductName(i.product)).join(', ')
      setCartMismatchWarning(`⚠️ Subtotal mismatch for ${names}: subtotal does not match qty × unit price.`)
    } else {
      setCartMismatchWarning(null)
    }
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

  const categories = useMemo(
    () => Array.from(new Set(products.map(product => (product.category as { name?: string })?.name ?? 'Uncategorized'))),
    [products]
  )

  const parentProducts = useMemo(
    () => products.filter(product => !product.parent_product_id),
    [products]
  )

  function getProductVariants(productId: string) {
    return products.filter(p => p.parent_product_id === productId && p.is_active)
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
        (product.category as { name?: string })?.name === categoryFilter
      return matchesSearch && matchesCategory
    })
  }, [parentProducts, search, categoryFilter])

  function addToCart(product: Product, tier?: PricingTier) {
    if (product.stock_qty === 0) {
      toast.error(`⚠️ ${formatProductName(product)} is out of stock!`)
      return
    }

    const unitPrice = tier ? Math.round((tier.price / tier.min_qty) * 100) / 100 : getEffectiveUnitPrice(product)
    const initialQty = tier ? tier.min_qty : getIncrementStep(product.unit, product)
    const step = tier ? tier.min_qty : getIncrementStep(product.unit, product)

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id)

      const next = existing
        ? prev.map(item => {
            if (item.product.id !== product.id) return item
            if (item.saleMode === 'amount') {
              const newSubtotal = Math.round((item.subtotal + item.subtotal) * 100) / 100
              const newUnitPrice = getEffectiveUnitPrice(item.product)
              const newQty = Math.round((newSubtotal / newUnitPrice) * 10) / 10
              return { ...item, quantity: newQty, subtotal: newSubtotal, saleMode: 'amount' as const }
            }
            const newQty = Math.round((item.quantity + step) * 10) / 10
            const newSubtotal = Math.round(newQty * unitPrice * 100) / 100
            return { ...item, quantity: newQty, subtotal: newSubtotal, saleMode: 'quantity' as const }
          })
        : [
            ...prev,
            {
              product,
              quantity: initialQty,
              subtotal: Math.round(initialQty * unitPrice * 100) / 100,
              saleMode: 'quantity' as const,
            },
          ]

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

  function handleProductSelect(product: Product, tier?: PricingTier) {
    addToCart(product, tier)
  }

  function isDecimalUnit(unit: string): boolean {
    const decimalUnits = ['liter', 'litre', 'ltr', 'ltrs', 'ml', 'gram', 'kg', 'oz', 'lb', 'gallon', 'pint', 'cup', 'tbsp', 'tsp', 'meter', 'm', 'cm', 'km']
    return decimalUnits.some(u => unit.toLowerCase().includes(u))
  }

  function getTiers(product: Product): PricingTier[] {
    if (!product.pricing_tiers) return []
    let tiers: PricingTier[] = []
    if (typeof product.pricing_tiers === 'string') {
      try {
        tiers = JSON.parse(product.pricing_tiers)
      } catch {
        return []
      }
    } else {
      tiers = product.pricing_tiers || []
    }
    return Array.isArray(tiers) ? tiers.filter(t => t && t.min_qty > 0 && t.price > 0) : []
  }

  function getSmallestTier(product: Product): PricingTier | null {
    const tiers = getTiers(product)
    if (tiers.length === 0) return null
    return tiers.slice().sort((a, b) => a.min_qty - b.min_qty)[0]
  }

  function getEffectiveUnitPrice(product: Product, qty: number = 1): number {
    const tier = getPricingTierForQty(product, qty)
    if (tier) {
      return Math.round((tier.price / tier.min_qty) * 100) / 100
    }
    return Number(product.price) || 0
  }

  function getPricingTierForQty(product: Product, qty: number): PricingTier | null {
    const tiers = getTiers(product)
    if (tiers.length === 0) return null
    const applicable = tiers.filter(t => t.min_qty <= qty).sort((a, b) => b.min_qty - a.min_qty)
    return applicable.length > 0 ? applicable[0] : tiers[0]
  }

  function getIncrementStep(unit: string, product?: Product): number {
    if (product) {
      const smallest = getSmallestTier(product)
      if (smallest) return smallest.min_qty
    }
    return isDecimalUnit(unit) ? 0.5 : 1
  }

  function formatQtyDisplay(qty: number, unit: string): string {
    return isDecimalUnit(unit) ? qty.toFixed(1) : qty.toString()
  }

  function updateQty(productId: string, qty: number) {
    const cartItem = cart.find(item => item.product.id === productId)
    if (!cartItem) return

    const isDecimal = isDecimalUnit(cartItem.product.unit)
    const validQty = Math.max(0.01, isNaN(qty) ? 0.01 : qty)
    const finalQty = isDecimal ? Math.round(validQty * 10) / 10 : Math.round(validQty)

    const unitPrice = getEffectiveUnitPrice(cartItem.product)

    setCart(prev =>
      prev.map(item =>
        item.product.id === productId
          ? { ...item, quantity: finalQty, subtotal: Math.round(finalQty * unitPrice * 100) / 100, saleMode: 'quantity' }
          : item
      )
    )
  }

  function increaseQty(productId: string) {
    const cartItem = cart.find(item => item.product.id === productId)
    if (!cartItem) return

    const step = getIncrementStep(cartItem.product.unit, cartItem.product)
    const newQty = cartItem.quantity + step

    const unitPrice = getEffectiveUnitPrice(cartItem.product)

    setCart(prev =>
      prev.map(item =>
        item.product.id === productId
          ? { ...item, quantity: Math.round(newQty * 10) / 10, subtotal: Math.round(newQty * 10) / 10 * unitPrice, saleMode: 'quantity' }
          : item
      )
    )
  }

  function decreaseQty(productId: string) {
    const cartItem = cart.find(item => item.product.id === productId)
    if (!cartItem) return

    const step = getIncrementStep(cartItem.product.unit, cartItem.product)
    const minQty = step
    const newQty = Math.max(minQty, cartItem.quantity - step)

    const unitPrice = getEffectiveUnitPrice(cartItem.product)

    setCart(prev =>
      prev.map(item =>
        item.product.id === productId
          ? { ...item, quantity: Math.round(newQty * 10) / 10, subtotal: Math.round(newQty * 10) / 10 * unitPrice, saleMode: 'quantity' }
          : item
      )
    )
  }

  function setCartItemMode(productId: string, saleMode: 'quantity' | 'amount') {
    setCart(prev =>
      prev.map(item => {
        if (item.product.id !== productId) return item

        const unitPrice = getEffectiveUnitPrice(item.product)

        if (saleMode === 'quantity') {
          const quantity = Math.max(0.01, item.quantity || 1)
          const subtotal = Math.round(quantity * unitPrice * 100) / 100
          return {
            ...item,
            saleMode,
            quantity,
            subtotal,
          }
        }

        if (unitPrice <= 0) return item
        const amount = Math.max(0.01, item.subtotal || unitPrice)
        const quantity = Math.round((amount / unitPrice) * 10) / 10
        const subtotal = Math.round(amount * 100) / 100
        return {
          ...item,
          saleMode,
          quantity,
          subtotal,
        }
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

  function getItemProfit(item: CartItem) {
    const cost = Number(item.product.cost_price || 0)
    const unitPrice = getEffectiveUnitPrice(item.product)
    return Math.round((unitPrice - cost) * item.quantity * 100) / 100
  }

  function getItemProfitPerUnit(item: CartItem) {
    const cost = Number(item.product.cost_price || 0)
    const unitPrice = getEffectiveUnitPrice(item.product)
    return Math.round((unitPrice - cost) * 100) / 100
  }

  function updateAmount(productId: string, amount: number) {
    if (amount < 0.01) return
    setCart(prev =>
      prev.map(item => {
        if (item.product.id !== productId) return item
        const unitPrice = getEffectiveUnitPrice(item.product)
        if (unitPrice <= 0) return item
        const quantity = Math.round((amount / unitPrice) * 10) / 10
        const subtotal = Math.round(amount * 100) / 100
        return {
          ...item,
          quantity,
          subtotal,
          saleMode: 'amount',
        }
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
    
    // Warn for large transactions
    if (totalAmount > 50000) {
      const confirm = window.confirm(`⚠️ Large transaction detected (${formatMoney(totalAmount, settings.currency)}). Are you sure?`)
      if (!confirm) {
        toast.info('Sale cancelled')
        return
      }
    }

    setSubmitting(true)

       const stockChecks = await Promise.all(
        cart.map(async item => {
          const { data: product, error } = await supabase.from('products').select('id, stock_qty').eq('id', item.product.id).single()
          if (error || !product) throw new Error(`Unable to verify stock for ${formatProductName(item.product)}`)
          if (Number(product.stock_qty) < item.quantity) {
            throw new Error(`${formatProductName(item.product)} only has ${product.stock_qty} ${item.product.unit} available`)
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
      const saleItems = cart.map(item => ({
        product_id: item.product.id,
        product_name: formatProductName(item.product),
        quantity: item.quantity,
        unit_price: getEffectiveUnitPrice(item.product),
        subtotal: item.subtotal,
      }))

      const { data: saleId, error: saleErr } = await supabase.rpc('record_sale', {
        p_user_id: user.id,
        p_shift_id: null,
        p_customer_id: customerId || null,
        p_subtotal: totalAmount,
        p_tax_amount: 0,
        p_total_amount: totalAmount,
        p_payment_type: paymentType,
        p_payment_method: paymentMethod,
        p_discount: 0,
        p_mpesa_ref: null,
        p_card_ref: null,
        p_amount_tendered: totalAmount,
        p_change_amount: 0,
        p_note: customer ? `Customer: ${customer}` : null,
        p_receipt_no: null,
        p_date: getLocalDateString(),
        p_items: saleItems,
      })

      if (saleErr || !saleId) {
        throw new Error(saleErr?.message ?? 'Failed to record sale')
      }

      await fetchProducts()
      window.dispatchEvent(new Event('drawer-update'))

      const completedSaleId = String(saleId)
      setCompletedSale({ id: completedSaleId, total: totalAmount, items: cart, customer })
      setCart([])
      setCustomer('')
      setPaymentType('cash')
      setPaymentMethod('cash')
      setIsReviewingPayment(false)
      setSubmitting(false)
      toast.success(`✓ Sale completed! Receipt #${completedSaleId.slice(0, 8).toUpperCase()} for ${formatMoney(totalAmount, settings.currency)}`)
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
  const totalProfit = cart.reduce((sum, item) => sum + getItemProfit(item), 0)

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
                              {getTiers(item.product).length > 0
                                ? `${getTiers(item.product).map(t => `${t.min_qty} @ ${formatMoney(t.price, settings.currency)}`).join(', ')} · ${formatMoney(getItemProfitPerUnit(item), settings.currency)} profit/unit · ${item.product.stock_qty.toLocaleString()} ${item.product.unit} in stock`
                                : `${formatMoney(item.product.price, settings.currency)} each · ${formatMoney(getItemProfitPerUnit(item), settings.currency)} profit/unit · ${item.product.stock_qty.toLocaleString()} ${item.product.unit} in stock`}
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
                                disabled={item.quantity <= getIncrementStep(item.product.unit, item.product)}
                                className="p-1 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed rounded"
                              >
                                <Minus className="w-3 h-3 text-slate-600" />
                              </button>
                              <input
                                type="number"
                                 min={getIncrementStep(item.product.unit, item.product).toString()}
                                step={getIncrementStep(item.product.unit, item.product).toString()}
                                value={formatQtyDisplay(item.quantity, item.product.unit)}
                                onChange={e => updateQty(item.product.id, Number(e.target.value) || getIncrementStep(item.product.unit, item.product))}
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
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Estimated profit</span>
                    <span className={totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}>{totalProfit >= 0 ? '+' : '-'}{formatMoney(Math.abs(totalProfit), settings.currency)}</span>
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
                <p className="text-sm text-slate-500">Search and select a variant under each main product.</p>
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
                const hasTiers = getTiers(product).length > 0
                const isGrouped = hasTiers
                return (
                  <div key={product.id} className="card p-4 hover:shadow-lg transition-shadow">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-semibold text-slate-900">{formatProductName(product)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${hasVariants ? 'bg-amber-100 text-amber-700' : isGrouped ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {hasVariants ? `${variants.length} variant${variants.length === 1 ? '' : 's'}` : isGrouped ? 'Tiered' : 'Product'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">{(product.category as { name?: string })?.name || 'Uncategorized'}</p>
                     <div className="grid gap-2 text-sm text-slate-600 mb-3">
                       <div className="flex items-center justify-between">
                         <span>Price</span>
                          <span className="font-semibold text-slate-900">
                            {hasTiers
                              ? `${getTiers(product).map(t => `${t.min_qty} @ ${formatMoney(t.price, settings.currency)}`).join(', ')}`
                              : formatMoney(product.price, settings.currency)}
                          </span>
                       </div>
                       <div className="flex items-center justify-between">
                         <span>Cost</span>
                         <span className="font-semibold text-slate-900">{formatMoney(product.cost_price ?? 0, settings.currency)}</span>
                       </div>
                       <div className="flex items-center justify-between">
                         <span>Profit/unit</span>
                         <span className="font-semibold text-slate-900">{formatMoney(getEffectiveUnitPrice(product) - (product.cost_price ?? 0), settings.currency)}</span>
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
                            const variantTiers = getTiers(variant)
                            if (variantTiers.length > 0) {
                              return (
                                <div key={variant.id} className="flex flex-col gap-1">
                                  {variantTiers.map((tier, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => handleProductSelect(variant, tier)}
                                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:border-purple-400 hover:bg-purple-100"
                                    >
                                      <Plus className="w-3 h-3" />
                                      {formatProductName(variant)} · {tier.min_qty} @ {formatMoney(tier.price, settings.currency)}
                                    </button>
                                  ))}
                                </div>
                              )
                            }
                            return (
                              <button
                                key={variant.id}
                                type="button"
                                onClick={() => handleProductSelect(variant)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
                              >
                                <Plus className="w-3 h-3" />
                                {formatProductName(variant)}
                                <span className="text-slate-400">({formatMoney(getEffectiveUnitPrice(variant), settings.currency)})</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                     {!hasVariants && (
                      (() => {
                        const productTiers = getTiers(product)
                        if (productTiers.length > 0) {
                          return (
                            <div className="space-y-2">
                              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Group Pricing</p>
                              <div className="flex flex-wrap gap-2">
                                {productTiers.map((tier: PricingTier, idx: number) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => handleProductSelect(product, tier)}
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700 transition hover:border-purple-400 hover:bg-purple-100"
                                  >
                                    <Plus className="w-3 h-3" />
                                    {tier.min_qty} @ {formatMoney(tier.price, settings.currency)}
                                  </button>
                                ))}
                              </div>
                              <p className="text-[10px] text-slate-400">
                                Per unit: {formatMoney(Math.round((productTiers[0].price / productTiers[0].min_qty) * 100) / 100, settings.currency)} — {productTiers.length} pricing option{productTiers.length === 1 ? '' : 's'} available
                              </p>
                            </div>
                          )
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => handleProductSelect(product)}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                          >
                            <Plus className="w-4 h-4" />
                            Add to cart
                          </button>
                        )
                      })()
                    )}
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
                {cartMismatchWarning && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {cartMismatchWarning}
                  </div>
                )}
                {cart.map(item => (
                  <div key={item.product.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-slate-900">{formatProductName(item.product)}</p>
                        <p className="text-xs text-slate-500">
                          {getTiers(item.product).length > 0
                            ? `${getTiers(item.product).map(t => `${t.min_qty} @ ${formatMoney(t.price, settings.currency)}`).join(', ')} · ${formatMoney(item.product.cost_price ?? 0, settings.currency)} cost · ${formatMoney(item.product.price - (item.product.cost_price ?? 0), settings.currency)} profit/unit · {item.product.stock_qty.toLocaleString()} ${item.product.unit} in stock`
                            : `${formatMoney(item.product.price, settings.currency)} per unit · ${formatMoney(item.product.cost_price ?? 0, settings.currency)} cost · ${formatMoney(item.product.price - (item.product.cost_price ?? 0), settings.currency)} profit/unit · {item.product.stock_qty.toLocaleString()} ${item.product.unit} in stock`}
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
                            disabled={item.quantity <= 0.01}
                            className="rounded p-1.5 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Decrease quantity"
                          >
                            <Minus className="w-4 h-4 text-slate-600" />
                          </button>
                          <input
                            type="number"
                            min={getIncrementStep(item.product.unit, item.product).toString()}
                            step={getIncrementStep(item.product.unit, item.product).toString()}
                            value={formatQtyDisplay(item.quantity, item.product.unit)}
                            onChange={e => updateQty(item.product.id, Number(e.target.value) || getIncrementStep(item.product.unit, item.product))}
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
    </div>
  )
}
