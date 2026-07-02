'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Product, SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatProductName } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { RoleGuard } from '@/components/RoleGuard'
import { Search, Plus, X, Package, TrendingUp, TrendingDown, History } from 'lucide-react'

export default function StockPage() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [stockLog, setStockLog] = useState<{ product_id: string; change_qty: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const supabase = createClient()
  const { settings } = useShopSettings()
  const toast = useToast()
  const router = useRouter()

  useEffect(() => {
    const session = getSession()
    if (!session) {
      router.push('/login')
      return
    }
    setUser(session)
    fetchProducts()
  }, [router])

  async function fetchProducts() {
    setLoading(true)
    setError('')

    try {
      const [{ data: productData }, { data: logData }] = await Promise.all([
        supabase
          .from('products')
          .select('*, category:categories(name)')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('stock_log')
          .select('product_id, change_qty')
          .eq('reason', 'sale')
      ])

      if (productData) {
        setProducts(productData)
        setStockLog(logData || [])
      } else {
        setProducts([])
        setStockLog([])
      }
      if (productData && productData.length > 0) {
        const parentData = productData.filter(p => !p.parent_product_id)
        const lowStockItems = parentData.filter(p => {
          const variants = productData.filter(v => v.parent_product_id === p.id)
          const aggregateStock = variants.length === 0 ? p.stock_qty : variants.reduce((sum, v) => sum + v.stock_qty, 0)
          return aggregateStock > 0 && aggregateStock <= p.stock_alert
        })
        const outOfStock = parentData.filter(p => {
          const variants = productData.filter(v => v.parent_product_id === p.id)
          const aggregateStock = variants.length === 0 ? p.stock_qty : variants.reduce((sum, v) => sum + v.stock_qty, 0)
          return aggregateStock === 0
        })
        if (lowStockItems.length > 0 || outOfStock.length > 0) {
          toast.warning(`⚠️ ${lowStockItems.length} low stock, ${outOfStock.length} out of stock`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error loading stock.'
      setError(message)
      toast.error(`❌ ${message}`)
      setProducts([])
      setStockLog([])
    } finally {
      setLoading(false)
    }
  }

  const inventoryProducts = useMemo(() => products.map(p => ({
    ...p,
    stock_qty: Number(p.stock_qty) || 0,
    initial_stock: Number(p.initial_stock) || 0,
    price: Number(p.price) || 0,
  })), [products])

  const categories = Array.from(new Set(inventoryProducts.map(p => (p.category as { name?: string })?.name || 'Uncategorized')))

  const parentProducts = useMemo(() => inventoryProducts.filter(p => !p.parent_product_id), [inventoryProducts])

  function getVariants(parentId: string) {
    return inventoryProducts.filter(p => p.parent_product_id === parentId)
  }

  function getAggregateStock(product: Product & { stock_qty: number }): number {
    const variants = getVariants(product.id)
    if (variants.length === 0) return product.stock_qty
    return variants.reduce((sum, v) => sum + v.stock_qty, 0)
  }

  function getAggregateInitialStock(product: Product & { stock_qty: number }): number {
    const variants = getVariants(product.id)
    if (variants.length === 0) return product.initial_stock || 0
    return variants.reduce((sum, v) => sum + (v.initial_stock || 0), 0)
  }

  function getSoldQty(productId: string): number {
    return Math.abs(stockLog
      .filter(l => l.product_id && productId === l.product_id)
      .reduce((sum, l) => sum + Number(l.change_qty || 0), 0))
  }

  const groupedProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return parentProducts.filter(product => {
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        (product.variety ?? '').toLowerCase().includes(query)
      const matchesCategory =
        categoryFilter === 'all' ||
        (product.category as { name?: string })?.name === categoryFilter
      const aggregateStock = getAggregateStock(product)
      const matchesStock =
        stockFilter === 'all' ||
        (stockFilter === 'in_stock' && aggregateStock > product.stock_alert) ||
        (stockFilter === 'low_stock' && aggregateStock > 0 && aggregateStock <= product.stock_alert) ||
        (stockFilter === 'out_of_stock' && aggregateStock === 0)
      return matchesSearch && matchesCategory && matchesStock
    })
  }, [parentProducts, search, categoryFilter, stockFilter])

  const inStock = parentProducts.filter(p => getAggregateStock(p) > p.stock_alert)
  const lowStock = parentProducts.filter(p => { const s = getAggregateStock(p); return s > 0 && s <= p.stock_alert })
  const outOfStock = parentProducts.filter(p => getAggregateStock(p) === 0)
  const totalValue = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    if (variants.length === 0) return sum + p.stock_qty * p.price
    return sum + variants.reduce((vSum, v) => vSum + v.stock_qty * v.price, 0)
  }, 0)

  const categoryValues = parentProducts.reduce((acc: Record<string, { qty: number; value: number }>, p) => {
    const variants = getVariants(p.id)
    const qty = variants.length === 0 ? p.stock_qty : variants.reduce((sum, v) => sum + v.stock_qty, 0)
    const value = variants.length === 0 ? p.stock_qty * p.price : variants.reduce((vSum, v) => vSum + v.stock_qty * v.price, 0)
    const cat = (p.category as { name?: string })?.name || 'Uncategorized'
    if (!acc[cat]) acc[cat] = { qty: 0, value: 0 }
    acc[cat].qty += qty
    acc[cat].value += value
    return acc
  }, {})

  const filteredProducts = useMemo(() => groupedProducts, [groupedProducts])

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>
  if (error) return <div className="flex items-center justify-center py-20 text-center text-sm text-red-600">{error}</div>

  return (
    <RoleGuard allowed={['owner', 'cashier']}>
      <div className="space-y-6">
        <PageHeader title="Inventory" description="Manage stock and products" />

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Products</p><p className="text-xl font-bold text-slate-900">{products.length}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500 mb-1">In Stock</p><p className="text-xl font-bold text-emerald-600">{inStock.length}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Low Stock</p><p className="text-xl font-bold text-amber-600">{lowStock.length}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Out of Stock</p><p className="text-xl font-bold text-red-600">{outOfStock.length}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Value</p><p className="text-xl font-bold text-brand-600">{formatMoney(totalValue, settings.currency)}</p></div>
        </div>

        {/* Category Values */}
        <div className="card p-5">
          <h3 className="font-bold text-slate-900 mb-3">Value by Category</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(categoryValues).map(([cat, data]) => (
              <div key={cat} className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
                <div><p className="text-sm font-medium text-slate-700">{cat}</p><p className="text-xs text-slate-400">{data.qty} units</p></div>
                <p className="text-sm font-bold text-slate-900">{formatMoney(data.value, settings.currency)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 w-full" /></div>
            <select className="input w-auto" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select className="input w-auto" value={stockFilter} onChange={e => setStockFilter(e.target.value)}>
              <option value="all">All Stock</option>
              <option value="in_stock">In Stock</option>
              <option value="low_stock">Low Stock</option>
              <option value="out_of_stock">Out of Stock</option>
            </select>
          </div>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProducts.length === 0 ? (
            <div className="col-span-full"><p className="text-slate-500 text-center py-12">No products match filters</p></div>
          ) : (
          filteredProducts.map(product => {
            const variants = getVariants(product.id)
            const aggregateStock = getAggregateStock(product)
            const aggregateInitial = getAggregateInitialStock(product)
            const totalSold = variants.length > 0
              ? variants.reduce((sum, v) => sum + getSoldQty(v.id), 0)
              : getSoldQty(product.id)
            const isLow = aggregateStock <= product.stock_alert && aggregateStock > 0
            const isOut = aggregateStock === 0
            const progress = aggregateInitial > 0 ? Math.min(100, Math.max(0, ((aggregateInitial - aggregateStock) / aggregateInitial) * 100)) : 0
            return (
              <div key={product.id} className="card p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className={'w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold ' + (isOut ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-700')}>
                    {product.name.charAt(0).toUpperCase()}
                  </div>
                  <span className={'px-2 py-1 rounded-full text-xs font-medium border ' + (isOut ? 'bg-red-100 text-red-700' : isLow ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                    {isOut ? 'Out' : isLow ? 'Low' : 'OK'}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 text-sm mb-1">{formatProductName(product)}</h3>
                <p className="text-xs text-slate-500 mb-1">
                  {formatMoney(product.price, settings.currency)} • <span className="font-semibold text-slate-700">{aggregateStock.toLocaleString()} {product.unit}</span>
                  {variants.length > 0 && <span className="text-slate-400"> total</span>}
                </p>
                {aggregateInitial > 0 && (
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Initial: {aggregateInitial.toLocaleString()} • Sold: {totalSold.toLocaleString()}</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5">
                      <div className="bg-brand-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>
                )}
                {variants.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {variants.map(v => (
                      <div key={v.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1">
                        <span className="text-slate-600">{formatProductName(v)}</span>
                        <span className={v.stock_qty === 0 ? 'text-red-600 font-medium' : v.stock_qty <= v.stock_alert ? 'text-amber-600 font-medium' : 'text-slate-900'}>
                          {v.stock_qty} {v.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-2">
                  Value: {formatMoney(aggregateStock * product.price, settings.currency)}
                </p>
              </div>
            )
          })
          )}
        </div>
      </div>
    </RoleGuard>
  )
}