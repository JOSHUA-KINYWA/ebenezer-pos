'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

interface StockProduct extends Product {
  soldUnits: number
  soldRevenue: number
  soldCost: number
  profit: number
  profitMargin: number
  initial_stock: number
  totalExpectedProfit: number
  remainingPotentialProfit: number
}

export default function StockPage() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [products, setProducts] = useState<StockProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [activeTab, setActiveTab] = useState<'inventory' | 'analysis'>('inventory')
  const [analysisFilter, setAnalysisFilter] = useState('all')
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)
  const supabase = createClient()
  const { settings } = useShopSettings()
  const toast = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const session = getSession()
    if (!session) {
      router.push('/login')
      return
    }
    setUser(session)
    const tab = searchParams.get('tab')
    if (tab === 'analysis') {
      setActiveTab('analysis')
    }
    fetchProducts()
  }, [router, searchParams])

  async function fetchProducts() {
    setLoading(true)
    setError('')

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, category:categories(name), initial_stock')
        .eq('is_active', true)
        .order('name')

      if (error) {
        setError(error.message)
        toast.error(`❌ Failed to load inventory: ${error.message}`)
        setProducts([])
        return
      }

      const productsData = data || []
      const activeProductIds = productsData.map(product => product.id)

      const { data: saleIdsData, error: saleIdsError } = await supabase
        .from('sales')
        .select('id')
        .eq('is_voided', false)

      if (saleIdsError) throw saleIdsError

      const saleIds = (saleIdsData || []).map(sale => sale.id)
      const { data: saleItemsData, error: saleItemsError } = activeProductIds.length > 0 && saleIds.length > 0
        ? await supabase
            .from('sale_items')
            .select('product_id, quantity, subtotal')
            .in('product_id', activeProductIds)
            .in('sale_id', saleIds)
        : { data: [], error: null }

      if (saleItemsError) throw saleItemsError

      const salesByProduct = new Map<string, { soldUnits: number; soldRevenue: number; soldCost: number }>()
      ;(saleItemsData || []).forEach(item => {
        if (!item.product_id) return
        const existing = salesByProduct.get(item.product_id) || { soldUnits: 0, soldRevenue: 0, soldCost: 0 }
        const quantity = Number(item.quantity || 0)
        const subtotal = Number(item.subtotal || 0)
        existing.soldUnits += quantity
        existing.soldRevenue += subtotal
        salesByProduct.set(item.product_id, existing)
      })

      const productsWithMetrics = productsData.map(product => {
        const variants = getVariants(product.id)
        const costPerUnit = Number(product.cost_price) || 0
        const margin = Number(product.price) - costPerUnit

        const aggregateSoldUnits = variants.length === 0
          ? Number(salesByProduct.get(product.id)?.soldUnits || 0)
          : variants.reduce((sum, v) => sum + Number(salesByProduct.get(v.id)?.soldUnits || 0), 0)

        const aggregateSoldRevenue = variants.length === 0
          ? Number(salesByProduct.get(product.id)?.soldRevenue || 0)
          : variants.reduce((sum, v) => sum + Number(salesByProduct.get(v.id)?.soldRevenue || 0), 0)

        const aggregateSoldCost = aggregateSoldUnits * costPerUnit
        const aggregateProfit = aggregateSoldRevenue - aggregateSoldCost
        const aggregateProfitMargin = aggregateSoldRevenue > 0 ? (aggregateProfit / aggregateSoldRevenue) * 100 : 0
        const aggregateStock = variants.length === 0 ? Number(product.stock_qty || 0) : variants.reduce((sum, v) => sum + Number(v.stock_qty || 0), 0)
        const aggregateInitialStock = variants.length === 0 ? Number(product.initial_stock || 0) : variants.reduce((sum, v) => sum + Number(v.initial_stock || 0), 0)

        const totalExpectedProfit = aggregateInitialStock * margin
        const remainingPotentialProfit = aggregateStock * margin

        return {
          ...product,
          soldUnits: aggregateSoldUnits,
          soldRevenue: aggregateSoldRevenue,
          soldCost: aggregateSoldCost,
          profit: aggregateProfit,
          profitMargin: aggregateProfitMargin,
          initial_stock: aggregateInitialStock,
          totalExpectedProfit,
          remainingPotentialProfit,
        }
      })

      setProducts(productsWithMetrics)
      if (productsWithMetrics.length > 0) {
        const lowStockItems = productsWithMetrics.filter(p => p.stock_qty <= p.stock_alert && p.stock_qty > 0)
        const outOfStock = productsWithMetrics.filter(p => p.stock_qty === 0)
        if (lowStockItems.length > 0 || outOfStock.length > 0) {
          toast.warning(`⚠️ ${lowStockItems.length} low stock, ${outOfStock.length} out of stock`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error loading stock.'
      setError(message)
      toast.error(`❌ ${message}`)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  const inventoryProducts = useMemo(() => products.map(p => ({
    ...p,
    stock_qty: Number(p.stock_qty) || 0,
    price: Number(p.price) || 0,
    soldUnits: Number(p.soldUnits || 0),
    soldRevenue: Number(p.soldRevenue || 0),
    soldCost: Number(p.soldCost || 0),
    profit: Number(p.profit || 0),
    profitMargin: Number(p.profitMargin || 0),
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

  const totalInitialStock = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    const initial = variants.length === 0 ? (p.initial_stock || 0) : variants.reduce((vSum, v) => vSum + (v.initial_stock || 0), 0)
    return sum + initial
  }, 0)

  const totalExpectedProfit = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    const expected = variants.length === 0 ? (p.totalExpectedProfit || 0) : variants.reduce((vSum, v) => vSum + (v.totalExpectedProfit || 0), 0)
    return sum + expected
  }, 0)

  const totalRemainingPotential = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    const remaining = variants.length === 0 ? (p.remainingPotentialProfit || 0) : variants.reduce((vSum, v) => vSum + (v.remainingPotentialProfit || 0), 0)
    return sum + remaining
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

  const totalSoldUnits = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    const sold = variants.length === 0 ? p.soldUnits : variants.reduce((vSum, v) => vSum + (v.soldUnits || 0), 0)
    return sum + sold
  }, 0)

  const totalProfit = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    const profit = variants.length === 0 ? p.profit : variants.reduce((vSum, v) => vSum + (v.profit || 0), 0)
    return sum + profit
  }, 0)

  const filteredProducts = useMemo(() => groupedProducts, [groupedProducts])

  const filteredAnalysis = useMemo(() => {
    const query = search.trim().toLowerCase()
    return inventoryProducts.filter(product => {
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        (product.variety ?? '').toLowerCase().includes(query)

      const matchesProfitability =
        analysisFilter === 'all' ||
        (analysisFilter === 'profitable' && product.profit > 0) ||
        (analysisFilter === 'breaking_even' && product.profit === 0) ||
        (analysisFilter === 'loss' && product.profit < 0 && product.soldUnits > 0) ||
        (analysisFilter === 'no_sales' && product.soldUnits === 0)

      return matchesSearch && matchesProfitability
    })
  }, [inventoryProducts, search, analysisFilter])

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>
  if (error) return <div className="flex items-center justify-center py-20 text-center text-sm text-red-600">{error}</div>

  return (
    <RoleGuard allowed={['owner', 'cashier']}>
      <div className="space-y-6">
        <PageHeader title="Inventory" description="Manage stock and products" />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 rounded-full bg-slate-100 p-1">
            <button
              type="button"
              className={`px-4 py-2 rounded-full text-sm font-semibold ${activeTab === 'inventory' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              onClick={() => setActiveTab('inventory')}
            >
              Inventory
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-full text-sm font-semibold ${activeTab === 'analysis' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              onClick={() => setActiveTab('analysis')}
            >
              Stock Analysis
            </button>
          </div>
          <div className="text-sm text-slate-500">
            Showing {activeTab === 'inventory' ? 'inventory controls and stock status' : 'profitability, sales, and stock analytics'}.
          </div>
        </div>

        {activeTab === 'inventory' ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Products</p><p className="text-xl font-bold text-slate-900">{products.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Items Sold</p><p className="text-xl font-bold text-slate-900">{totalSoldUnits.toLocaleString()}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">In Stock</p><p className="text-xl font-bold text-emerald-600">{inStock.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Low Stock</p><p className="text-xl font-bold text-amber-600">{lowStock.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Profit</p><p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(totalProfit, settings.currency)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Projected Profit</p><p className="text-xl font-bold text-brand-600">{formatMoney(totalExpectedProfit, settings.currency)}</p></div>
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
          </>
        ) : (
          <>
            <div className="card p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 w-full" /></div>
                <select className="input w-auto" value={analysisFilter} onChange={e => setAnalysisFilter(e.target.value)}>
                  <option value="all">All Products</option>
                  <option value="profitable">Profitable</option>
                  <option value="breaking_even">Breaking Even</option>
                  <option value="loss">Loss Making</option>
                  <option value="no_sales">No Sales</option>
                </select>
              </div>
            </div>
          </>
        )}
        {activeTab === 'inventory' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProducts.length === 0 ? (
              <div className="col-span-full"><p className="text-slate-500 text-center py-12">No products match filters</p></div>
            ) : (
            filteredProducts.map(product => {
              const variants = getVariants(product.id)
              const aggregateStock = getAggregateStock(product)
              const isLow = aggregateStock <= product.stock_alert && aggregateStock > 0
              const isOut = aggregateStock === 0
              const isExpanded = expandedProductId === product.id
              return (
                <div key={product.id} className="card hover:shadow-md transition-shadow cursor-pointer" onClick={() => setExpandedProductId(isExpanded ? null : product.id)}>
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className={'w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold ' + (isOut ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-700')}>
                        {product.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={'px-2 py-1 rounded-full text-xs font-medium border ' + (isOut ? 'bg-red-100 text-red-700' : isLow ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                          {isOut ? 'Out' : isLow ? 'Low' : 'OK'}
                        </span>
                        <span className="text-xs text-slate-400">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    <h3 className="font-semibold text-slate-900 text-sm mb-1">{formatProductName(product)}</h3>
                    <p className="text-xs text-slate-500 mb-1">
                      {formatMoney(product.price, settings.currency)} • <span className="font-semibold text-slate-700">{aggregateStock.toLocaleString()} {product.unit}</span>
                      {variants.length > 0 && <span className="text-slate-400"> total</span>}
                    </p>
                    {variants.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {variants.map(v => (
                          <div key={v.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1">
                            <span className="text-slate-600">{formatProductName(v)}</span>
                            <span className={v.stock_qty === 0 ? 'text-red-600 font-medium' : v.stock_qty <= v.stock_alert ? 'text-amber-600 font-medium' : 'text-slate-900'}>
                              {v.stock_qty.toLocaleString()} {v.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-slate-400 mt-2">
                      Initial: {(product.initial_stock || 0).toLocaleString()} {product.unit} • Value: {formatMoney(aggregateStock * product.price, settings.currency)}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Sold: {product.soldUnits.toLocaleString()} • Profit: <span className={product.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>{formatMoney(product.profit, settings.currency)}</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Expected: <span className="text-slate-600">{formatMoney(product.totalExpectedProfit, settings.currency)}</span>
                      {product.remainingPotentialProfit > 0 && <span> • Remaining: <span className="text-amber-600">{formatMoney(product.remainingPotentialProfit, settings.currency)}</span></span>}
                    </p>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50 p-4" onClick={e => e.stopPropagation()}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm mb-4">
                        <div><span className="text-slate-500">Selling price</span><p className="font-semibold text-slate-900">{formatMoney(product.price, settings.currency)}</p></div>
                        <div><span className="text-slate-500">Buying price</span><p className="font-semibold text-slate-900">{formatMoney(product.cost_price ?? 0, settings.currency)}</p></div>
                        <div><span className="text-slate-500">Margin/unit</span><p className="font-semibold text-slate-900">{formatMoney((product.price || 0) - (product.cost_price ?? 0), settings.currency)}</p></div>
                        <div><span className="text-slate-500">Initial stock</span><p className="font-semibold text-slate-900">{(product.initial_stock || 0).toLocaleString()} {product.unit}</p></div>
                        <div><span className="text-slate-500">Current stock</span><p className="font-semibold text-slate-900">{aggregateStock.toLocaleString()} {product.unit}</p></div>
                        <div><span className="text-slate-500">Low alert</span><p className="font-semibold text-slate-900">{product.stock_alert} {product.unit}</p></div>
                        <div><span className="text-slate-500">Sold units</span><p className="font-semibold text-slate-900">{product.soldUnits.toLocaleString()}</p></div>
                        <div><span className="text-slate-500">Profit so far</span><p className={`font-semibold ${product.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(product.profit, settings.currency)}</p></div>
                        <div><span className="text-slate-500">Expected profit</span><p className="font-semibold text-slate-900">{formatMoney(product.totalExpectedProfit, settings.currency)}</p></div>
                      </div>

                      {variants.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-semibold text-slate-700 uppercase mb-2">Variant breakdown</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-slate-200 text-slate-500 text-xs"><th className="py-1 text-left">Variant</th><th className="py-1 text-left">Stock</th><th className="py-1 text-left">Initial</th><th className="py-1 text-right">Sold</th><th className="py-1 text-right">Expected profit</th><th className="py-1 text-right">Remaining</th></tr></thead>
                              <tbody className="divide-y divide-slate-100">
                                {variants.map(v => {
                                  const vMargin = (v.price || 0) - (v.cost_price ?? 0)
                                  const vSold = v.soldUnits || 0
                                  const vStock = v.stock_qty || 0
                                  const vInitial = v.initial_stock || 0
                                  const vExpected = vInitial * vMargin
                                  const vRemaining = vStock * vMargin
                                  return (
                                    <tr key={v.id}>
                                      <td className="py-1.5 text-slate-900 font-medium">{formatProductName(v)}</td>
                                      <td className="py-1.5 text-slate-600">{vStock.toLocaleString()} {v.unit}</td>
                                      <td className="py-1.5 text-slate-600">{vInitial.toLocaleString()} {v.unit}</td>
                                      <td className="py-1.5 text-right text-slate-600">{vSold.toLocaleString()}</td>
                                      <td className="py-1.5 text-right text-slate-900">{formatMoney(vExpected, settings.currency)}</td>
                                      <td className="py-1.5 text-right text-amber-600">{formatMoney(vRemaining, settings.currency)}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Revenue</p><p className="text-xl font-bold text-brand-600">{formatMoney(totalSoldUnits > 0 ? totalProfit + products.reduce((sum, p) => sum + p.soldCost, 0) : 0, settings.currency)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Profit</p><p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(totalProfit, settings.currency)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Profit Margin</p><p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{products.reduce((sum, p) => sum + p.soldRevenue, 0) > 0 ? `${((totalProfit / products.reduce((sum, p) => sum + p.soldRevenue, 0)) * 100).toFixed(1)}%` : '0.0%'}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Items Sold</p><p className="text-xl font-bold text-slate-900">{totalSoldUnits.toLocaleString()}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Loss Making</p><p className="text-xl font-bold text-red-600">{inventoryProducts.filter(p => p.profit < 0 && p.soldUnits > 0).length}</p></div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {filteredAnalysis.length === 0 ? (
                <div className="card p-8 text-center text-slate-500">No products match analysis filters</div>
              ) : (
                filteredAnalysis.map(product => {
                  const isProfitable = product.profit > 0
                  const isLoss = product.profit < 0
                  return (
                    <div key={product.id} className="card p-4 hover:shadow-md transition-shadow">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{formatProductName(product)}</p>
                          <p className="text-xs text-slate-500">Stock: {product.stock_qty.toLocaleString()} {product.unit} • Sold: {product.soldUnits.toLocaleString()}</p>
                        </div>
                        <div className="flex gap-4 text-right">
                          <div>
                            <p className="text-xs text-slate-500">Revenue</p>
                            <p className="font-semibold text-slate-900">{formatMoney(product.soldRevenue, settings.currency)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Cost</p>
                            <p className="font-semibold text-slate-900">{formatMoney(product.soldCost, settings.currency)}</p>
                          </div>
                          <div className={isProfitable ? 'text-emerald-600' : isLoss ? 'text-red-600' : 'text-amber-600'}>
                            <p className="text-xs text-slate-500">Profit</p>
                            <p className="font-semibold text-lg">{formatMoney(product.profit, settings.currency)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm text-slate-500">
                        <div><span className="font-medium text-slate-700">Initial Stock:</span> {(product.initial_stock || 0).toLocaleString()} {product.unit}</div>
                        <div><span className="font-medium text-slate-700">Current:</span> {product.stock_qty.toLocaleString()} {product.unit}</div>
                        <div><span className="font-medium text-slate-700">Margin:</span> {product.soldRevenue > 0 ? `${product.profitMargin.toFixed(1)}%` : '0.0%'}</div>
                        <div><span className="font-medium text-slate-700">Expected Profit:</span> {formatMoney(product.totalExpectedProfit, settings.currency)}</div>
                        <div><span className="font-medium text-slate-700">Remaining:</span> <span className="text-amber-600">{formatMoney(product.remainingPotentialProfit, settings.currency)}</span></div>
                        <div><span className="font-medium text-slate-700">Sold:</span> {product.soldUnits.toLocaleString()}</div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  )
}
