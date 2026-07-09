'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Product, SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatProductName } from '@/lib/format'
import { format } from 'date-fns'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { RoleGuard } from '@/components/RoleGuard'
import { Search, TrendingUp, TrendingDown, History, Package, BarChart3 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

type Tab = 'products' | 'history' | 'movements' | 'profit' | 'stats'

export default function StockPage() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [stockLog, setStockLog] = useState<any[]>([])
  const [sales, setSales] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [activeTab, setActiveTab] = useState<Tab>('products')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [profitSearch, setProfitSearch] = useState('')
  const [profitCategoryFilter, setProfitCategoryFilter] = useState('all')
  const [profitSort, setProfitSort] = useState<'desc' | 'asc'>('desc')
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
      const [{ data: productData }, { data: logData }, { data: salesData }] = await Promise.all([
        supabase
          .from('products')
          .select('*, category:categories(name)')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('stock_log')
          .select('*, product:products(name, variety, unit)')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('sales')
          .select('total_amount, created_at')
          .order('created_at', { ascending: false })
          .limit(500)
      ])

      if (productData) {
        setProducts(productData)
        setStockLog(logData || [])
        setSales(salesData || [])
      } else {
        setProducts([])
        setStockLog([])
        setSales([])
      }
      if (productData && productData.length > 0) {
        const parentData = productData.filter(p => !p.parent_product_id)
        const lowStockItems = parentData.filter(p => {
          const variants = productData.filter(v => v.parent_product_id === p.id)
          const aggregateStock = variants.length === 0 ? p.stock_qty : variants.reduce((sum: number, v: any) => sum + (v.stock_qty || 0), 0)
          return aggregateStock > 0 && aggregateStock <= p.stock_alert
        })
        const outOfStock = parentData.filter(p => {
          const variants = productData.filter(v => v.parent_product_id === p.id)
          const aggregateStock = variants.length === 0 ? p.stock_qty : variants.reduce((sum: number, v: any) => sum + (v.stock_qty || 0), 0)
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
      setSales([])
    } finally {
      setLoading(false)
    }
  }

  const inventoryProducts = useMemo(() => products.map(p => ({
    ...p,
    stock_qty: Number(p.stock_qty) || 0,
    initial_stock: Number(p.initial_stock) || 0,
    price: Number(p.price) || 0,
    cost_price: Number(p.cost_price) || 0,
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
      .filter(l => l.product_id && productId === l.product_id && l.reason === 'sale')
      .reduce((sum, l) => sum + Number(l.change_qty || 0), 0))
  }

  function getRestockedQty(productId: string): number {
    return stockLog
      .filter(l => l.product_id === productId && (l.reason === 'restock' || Number(l.change_qty) > 0))
      .reduce((sum, l) => sum + Math.max(0, Number(l.change_qty || 0)), 0)
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

  // Stock analytics
  const totalInitialStock = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    return variants.length === 0 ? sum + (p.initial_stock || 0) : sum + variants.reduce((vSum, v) => vSum + (v.initial_stock || 0), 0)
  }, 0)

  const totalCurrentStock = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    return variants.length === 0 ? sum + p.stock_qty : sum + variants.reduce((vSum, v) => vSum + v.stock_qty, 0)
  }, 0)

  const totalSoldUnits = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    return variants.length === 0 ? sum + getSoldQty(p.id) : sum + variants.reduce((vSum, v) => vSum + getSoldQty(v.id), 0)
  }, 0)

  const totalRestocked = stockLog
    .filter(l => l.reason === 'restock' && l.change_qty > 0)
    .reduce((sum, l) => sum + Number(l.change_qty), 0)

  const totalValue = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    if (variants.length === 0) return sum + p.stock_qty * p.price
    return sum + variants.reduce((vSum, v) => vSum + v.stock_qty * v.price, 0)
  }, 0)

  const totalBuyingCost = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    const initial = variants.length === 0 ? (p.initial_stock || 0) : variants.reduce((vSum, v) => vSum + (v.initial_stock || 0), 0)
    const cost = variants.length === 0 ? (p.cost_price || 0) : p.cost_price || 0
    return sum + initial * cost
  }, 0)

  const totalProfit = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    const sold = variants.length === 0 ? getSoldQty(p.id) : variants.reduce((vSum, v) => vSum + getSoldQty(v.id), 0)
    const costPrice = p.cost_price || 0
    return sum + sold * (p.price - costPrice)
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

  // Monthly profit analytics
  const monthlyProfits = useMemo(() => {
    const monthly: Record<string, { revenue: number; cost: number; profit: number }> = {}
    sales.forEach(sale => {
      const month = format(new Date(sale.created_at), 'yyyy-MM')
      if (!monthly[month]) monthly[month] = { revenue: 0, cost: 0, profit: 0 }
      monthly[month].revenue += Number(sale.total_amount)
    })
    // Calculate cost based on sold items
    stockLog
      .filter(l => l.reason === 'sale')
      .forEach(l => {
        const prod = products.find(p => p.id === l.product_id)
        if (prod && l.change_qty) {
          const month = format(new Date(l.created_at || new Date()), 'yyyy-MM')
          if (!monthly[month]) monthly[month] = { revenue: 0, cost: 0, profit: 0 }
          monthly[month].cost += Math.abs(Number(l.change_qty)) * Number(prod.cost_price || prod.price || 0)
        }
      })
    Object.keys(monthly).forEach(m => {
      monthly[m].profit = monthly[m].revenue - monthly[m].cost
    })
    return Object.entries(monthly).map(([month, data]) => ({
      month: format(new Date(month), 'MMM yyyy'),
      ...data
    }))
  }, [sales, stockLog, products])

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>
  if (error) return <div className="flex items-center justify-center py-20 text-center text-sm text-red-600">{error}</div>

  return (
    <RoleGuard allowed={['owner', 'cashier']}>
      <div className="space-y-6">
        <PageHeader title="Inventory" description="Manage stock and products" />

        {/* Tabs */}
        <div className="flex border-b border-slate-200 mb-4">
          {(['products', 'history', 'movements', 'profit', 'stats'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all ${activeTab === tab ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`}
            >
              {tab === 'products' ? 'Products' : tab === 'history' ? 'Stock Analytics' : tab === 'movements' ? 'Product Movements' : tab === 'profit' ? 'Profit' : 'Stats'}
            </button>
          ))}
        </div>

        {activeTab === 'products' && (
          <>
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
              {groupedProducts.length === 0 ? (
                <div className="col-span-full"><p className="text-slate-500 text-center py-12">No products match filters</p></div>
              ) : (
                groupedProducts.map(product => {
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
                        {formatMoney(product.price, settings.currency)} sell • {formatMoney(product.cost_price || 0, settings.currency)} buy • <span className="font-semibold text-slate-700">{aggregateStock.toLocaleString()} {product.unit}</span>
                        {variants.length > 0 && <span className="text-slate-400"> total</span>}
                      </p>
                      {aggregateInitial > 0 && (
                        <div className="mb-2">
                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span className="font-medium">Initial: {aggregateInitial.toLocaleString()}</span>
                            <span className="font-medium">Current: {aggregateStock.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                            <span>Sold: {totalSold.toLocaleString()}</span>
                            <span>Remaining: {(aggregateInitial - totalSold).toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-1.5">
                            <div className="bg-gradient-to-r from-slate-400 to-brand-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}
        {(activeTab as Tab) === 'stats' && (
          <div className="space-y-6">
            {/* Stats Overview */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Products</p><p className="text-xl font-bold text-slate-900">{products.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Categories</p><p className="text-xl font-bold text-slate-900">{categories.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Initial Stock</p><p className="text-xl font-bold text-slate-900">{parentProducts.reduce((sum, p) => { const variants = getVariants(p.id); const initial = variants.length === 0 ? (p.initial_stock || 0) : variants.reduce((vSum, v) => vSum + (v.initial_stock || 0), 0); return sum + initial; }, 0).toLocaleString()}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Current Stock</p><p className="text-xl font-bold text-emerald-600">{parentProducts.reduce((sum, p) => { const variants = getVariants(p.id); const current = variants.length === 0 ? p.stock_qty : variants.reduce((vSum, v) => vSum + v.stock_qty, 0); return sum + current; }, 0).toLocaleString()}</p></div>
            </div>

            {/* Value by Category */}
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

            {/* Stock Health */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="card p-5">
                <h3 className="font-bold text-slate-900 mb-3">Stock Health</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">In Stock</span>
                    <span className="text-sm font-bold text-emerald-600">{inStock.length} products</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${products.length ? (inStock.length / products.length) * 100 : 0}%` }}></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Low Stock</span>
                    <span className="text-sm font-bold text-amber-600">{lowStock.length} products</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${products.length ? (lowStock.length / products.length) * 100 : 0}%` }}></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Out of Stock</span>
                    <span className="text-sm font-bold text-red-600">{outOfStock.length} products</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div className="bg-red-500 h-2 rounded-full" style={{ width: `${products.length ? (outOfStock.length / products.length) * 100 : 0}%` }}></div>
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <h3 className="font-bold text-slate-900 mb-3">Financial Summary</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Total Buying Cost</span>
                    <span className="text-sm font-bold text-amber-600">{formatMoney(totalBuyingCost, settings.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Inventory Value</span>
                    <span className="text-sm font-bold text-brand-600">{formatMoney(totalValue, settings.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Total Profit</span>
                    <span className={`text-sm font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(totalProfit, settings.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Potential Profit</span>
                    <span className="text-sm font-bold text-emerald-600">{formatMoney(totalValue - totalBuyingCost, settings.currency)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
                      {variants.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {variants.map(v => {
                            const vInitial = v.initial_stock || 0
                            const vSold = getSoldQty(v.id)
                            const vProgress = vInitial > 0 ? Math.min(100, Math.max(0, ((vInitial - v.stock_qty) / vInitial) * 100)) : 0
                            return (
                              <div key={v.id} className="text-xs bg-slate-50 rounded px-2 py-1.5">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-medium text-slate-700">{formatProductName(v)}</span>
                                  <span className={v.stock_qty === 0 ? 'text-red-600 font-medium' : v.stock_qty <= v.stock_alert ? 'text-amber-600 font-medium' : 'text-slate-900'}>
                                    {v.stock_qty} {v.unit}
                                  </span>
                                </div>
                                {vInitial > 0 && (
                                  <>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                                      <span>Init: {vInitial.toLocaleString()} • Sold: {vSold.toLocaleString()}</span>
                                      <span>Rem: {(vInitial - vSold).toLocaleString()}</span>
                                    </div>
                                    <div className="w-full bg-slate-200 rounded-full h-1">
                                      <div className="bg-gradient-to-r from-slate-300 to-emerald-500 h-1 rounded-full transition-all" style={{ width: `${vProgress}%` }}></div>
                                    </div>
                                  </>
                                )}
                              </div>
                            )
                          })}
                          {aggregateInitial > 0 && (
                            <div className="pt-1 border-t border-slate-200">
                              <div className="flex justify-between text-xs text-slate-500 mb-1">
                                <span>Total • Sold: {totalSold.toLocaleString()} / {aggregateInitial.toLocaleString()}</span>
                                <span>Progress</span>
                              </div>
                              <div className="w-full bg-slate-200 rounded-full h-1.5">
                                <div className="bg-gradient-to-r from-slate-400 to-brand-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-slate-400 mt-2">
                        Value: {formatMoney(aggregateStock * product.price, settings.currency)}
                      </p>
                      <button
                        onClick={() => { setSelectedProduct(product.id); setActiveTab('movements') }}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
                      >
                        <History className="w-3 h-3" /> View movements
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Products</p><p className="text-xl font-bold text-slate-900">{products.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">In Stock</p><p className="text-xl font-bold text-emerald-600">{inStock.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Low Stock</p><p className="text-xl font-bold text-amber-600">{lowStock.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Out of Stock</p><p className="text-xl font-bold text-red-600">{outOfStock.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Buying Cost</p><p className="text-xl font-bold text-amber-600">{formatMoney(totalBuyingCost, settings.currency)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Inventory Value</p><p className="text-xl font-bold text-brand-600">{formatMoney(totalValue, settings.currency)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Profit</p><p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(totalProfit, settings.currency)}</p></div>
            </div>
          </>
        )}

        {activeTab === 'movements' && (
          <div className="card">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <History className="w-4 h-4" />
                {selectedProduct ? 'Product Movement History' : 'All Product Movements'}
                {selectedProduct && (
                  <button onClick={() => { setSelectedProduct(null); setActiveTab('products') }} className="text-xs text-slate-500 ml-2">← Back</button>
                )}
              </h3>
            </div>
            <div className="p-4">
              {selectedProduct ? (
                <div className="space-y-4">
                  {stockLog
                    .filter(l => l.product_id === selectedProduct)
                    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                    .map((entry, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 rounded bg-slate-50">
                        <div className="flex items-center gap-2">
                          {Number(entry.change_qty) > 0 ? (
                            <TrendingUp className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-red-600" />
                          )}
                          <span className="capitalize text-slate-700">{entry.reason || 'adjustment'}</span>
                        </div>
                        <div className="text-right">
                          <span className={Number(entry.change_qty) > 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                            {Number(entry.change_qty) > 0 ? '+' : ''}{Number(entry.change_qty)}
                          </span>
                          <span className="text-xs text-slate-400 block">
                            {entry.created_at && format(new Date(entry.created_at), 'dd MMM yyyy HH:mm')}
                          </span>
                        </div>
                      </div>
                    ))}
                  {stockLog.filter(l => l.product_id === selectedProduct).length === 0 && (
                    <p className="text-center text-slate-500 py-8">No movements for this product</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-slate-600 mb-3">Select a product to view its movement history, or view all movements below:</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500">
                          <th className="py-2 text-left pl-4">Product</th>
                          <th className="py-2 text-left">Type</th>
                          <th className="py-2 text-right">Change</th>
                          <th className="py-2 text-right">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockLog.slice(0, 100).map((entry, idx) => {
                          const product = products.find(p => p.id === entry.product_id)
                          const productName = product ? formatProductName(product) : 'Unknown'
                          return (
                            <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedProduct(entry.product_id)}>
                              <td className="py-2 pl-4">
                                <span className="font-medium text-slate-900">{productName}</span>
                              </td>
                              <td className="py-2">
                                <span className={`px-2 py-1 rounded text-xs ${entry.reason === 'sale' ? 'bg-red-100 text-red-700' : entry.reason === 'restock' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {entry.reason || 'adjustment'}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-right font-medium">
                                <span className={Number(entry.change_qty) > 0 ? 'text-emerald-600' : 'text-red-600'}>
                                  {Number(entry.change_qty) > 0 ? '+' : ''}{Number(entry.change_qty)}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-right text-slate-500">
                                {entry.created_at && format(new Date(entry.created_at), 'dd MMM HH:mm')}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Stock Summary in amounts */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Initial Value</p><p className="text-xl font-bold text-slate-900">{formatMoney(parentProducts.reduce((sum, p) => { const variants = getVariants(p.id); const initial = variants.length === 0 ? (p.initial_stock || 0) : variants.reduce((vSum, v) => vSum + (v.initial_stock || 0), 0); return sum + initial * p.price; }, 0), settings.currency)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Current Value</p><p className="text-xl font-bold text-emerald-600">{formatMoney(parentProducts.reduce((sum, p) => { const variants = getVariants(p.id); const current = variants.length === 0 ? p.stock_qty : variants.reduce((vSum, v) => vSum + v.stock_qty, 0); return sum + current * p.price; }, 0), settings.currency)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Sold Value</p><p className="text-xl font-bold text-red-600">{formatMoney(parentProducts.reduce((sum, p) => { const variants = getVariants(p.id); const sold = variants.length === 0 ? getSoldQty(p.id) : variants.reduce((vSum, v) => vSum + getSoldQty(v.id), 0); return sum + sold * p.price; }, 0), settings.currency)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Cost Value</p><p className="text-xl font-bold text-amber-600">{formatMoney(parentProducts.reduce((sum, p) => { const variants = getVariants(p.id); const initial = variants.length === 0 ? (p.initial_stock || 0) : variants.reduce((vSum, v) => vSum + (v.initial_stock || 0), 0); return sum + initial * (p.cost_price || 0); }, 0), settings.currency)}</p></div>
            </div>

            {/* Stock Reduction Chart */}
            <div className="card p-5">
              <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Stock Movement Trend
              </h3>
              <div className="h-[200px]">
                {monthlyProfits.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyProfits}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v: number) => formatMoney(v, settings.currency)} />
                      <Bar dataKey="revenue" fill="#16a34a" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="cost" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-slate-500 py-8">No data for chart</p>
                )}
              </div>
            </div>

            {/* Profit Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card p-5">
                <h3 className="font-bold text-slate-900 mb-3">Monthly Profit Summary</h3>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {monthlyProfits.length === 0 ? (
                    <p className="text-xs text-slate-500">No monthly data</p>
                  ) : (
                    monthlyProfits.map(m => (
                      <div key={m.month} className="flex justify-between text-sm">
                        <span className="text-slate-600">{m.month}</span>
                        <span className={m.profit >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                          {formatMoney(m.profit, settings.currency)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="card p-5 lg:col-span-2">
                <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                  <History className="w-4 h-4" /> Recent Stock Movements
                </h3>
                <div className="overflow-x-auto">
                  {stockLog.length === 0 ? (
                    <div className="p-4 text-center text-slate-500">
                      <History className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p>No stock movements recorded</p>
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500">
                          <th className="py-2 text-left pl-4">Product</th>
                          <th className="py-2 text-left">Type</th>
                          <th className="py-2 text-right">Change</th>
                          <th className="py-2 text-right">Date</th>
                          <th className="py-2 text-left pr-4">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockLog.slice(0, 50).map((entry, idx) => {
                          const product = products.find(p => p.id === entry.product_id)
                          const productName = product ? formatProductName(product) : 'Unknown'
                          return (
                            <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="py-2 pl-4">
                                <span className="font-medium text-slate-900">{productName}</span>
                              </td>
                              <td className="py-2">
                                <span className={`px-2 py-1 rounded text-xs ${entry.reason === 'sale' ? 'bg-red-100 text-red-700' : entry.reason === 'restock' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {entry.reason || 'adjustment'}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-right">
                                <span className={Number(entry.change_qty) > 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                                  {Number(entry.change_qty) > 0 ? '+' : ''}{Number(entry.change_qty)}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-right text-slate-500">
                                {entry.created_at && format(new Date(entry.created_at), 'dd MMM HH:mm')}
                              </td>
                              <td className="py-2 pr-4 text-slate-500 max-w-xs truncate">
                                {entry.note || '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'profit' && (
          <div className="card p-5">
            <h3 className="font-bold text-slate-900 mb-4">Profit per Product</h3>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={profitSearch}
                  onChange={e => setProfitSearch(e.target.value)}
                  className="input pl-9 w-full"
                />
              </div>
              <select className="input w-auto" value={profitCategoryFilter} onChange={e => setProfitCategoryFilter(e.target.value)}>
                <option value="all">All Categories</option>
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <select className="input w-auto" value={profitSort} onChange={e => setProfitSort(e.target.value as 'desc' | 'asc')}>
                <option value="desc">Highest profit first</option>
                <option value="asc">Lowest profit first</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="py-2 text-left pl-4">Product</th>
                    <th className="py-2 text-right">Buying price</th>
                    <th className="py-2 text-right">Selling price</th>
                    <th className="py-2 text-right">Sold</th>
                    <th className="py-2 text-right">Profit/unit</th>
                    <th className="py-2 text-right">Total profit</th>
                  </tr>
                </thead>
                <tbody>
                  {parentProducts
                    .map(p => {
                      const variants = getVariants(p.id)
                      const sold = variants.length === 0 ? getSoldQty(p.id) : variants.reduce((sum, v) => sum + getSoldQty(v.id), 0)
                      const profit = sold * (p.price - (p.cost_price || 0))
                      return { ...p, sold, profit }
                    })
                    .filter(p => {
                      const matchesSearch = !profitSearch || p.name.toLowerCase().includes(profitSearch.toLowerCase()) || ((p.category as { name?: string })?.name || '').toLowerCase().includes(profitSearch.toLowerCase())
                      const matchesCategory = profitCategoryFilter === 'all' || ((p.category as { name?: string })?.name || 'Uncategorized') === profitCategoryFilter
                      return matchesSearch && matchesCategory
                    })
                    .sort((a, b) => profitSort === 'desc' ? b.profit - a.profit : a.profit - b.profit)
                    .map(p => (
                      <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2 pl-4 font-medium text-slate-900">{formatProductName(p)}</td>
                        <td className="py-2 pr-4 text-right">{formatMoney(p.cost_price || 0, settings.currency)}</td>
                        <td className="py-2 pr-4 text-right">{formatMoney(p.price, settings.currency)}</td>
                        <td className="py-2 pr-4 text-right">{p.sold.toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right">{formatMoney(p.price - (p.cost_price || 0), settings.currency)}</td>
                        <td className={`py-2 pr-4 text-right font-medium ${p.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(p.profit, settings.currency)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  )
}