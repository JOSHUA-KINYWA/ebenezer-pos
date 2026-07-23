'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Product, SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatProductName, getLocalDateString } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { Modal } from '@/components/Modal'
import { RoleGuard } from '@/components/RoleGuard'
import { Search, Package, TrendingUp, TrendingDown, History, Save, Calendar } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'

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
  const [selectedProduct, setSelectedProduct] = useState<StockProduct | null>(null)
  const [activeView, setActiveView] = useState<'inventory' | 'analysis' | 'settings' | 'trends'>('inventory')
  const [trendPeriod, setTrendPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [trendStartDate, setTrendStartDate] = useState('')
  const [trendEndDate, setTrendEndDate] = useState('')
  const [chartData, setChartData] = useState<any[]>([])
  const [topProducts, setTopProducts] = useState<any[]>([])
  const [periodProfit, setPeriodProfit] = useState(0)
  const [bulkStocks, setBulkStocks] = useState<Record<string, { initial: string; qty: string }>>({})
  const [savingBulk, setSavingBulk] = useState(false)
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
      setActiveView('analysis')
    }
    fetchProducts()
  }, [router, searchParams])

  useEffect(() => {
    if (activeView === 'trends') {
      fetchTrendData()
      fetchTopProducts()
      fetchPeriodProfit()
    }
  }, [activeView, trendPeriod, trendStartDate, trendEndDate])

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

  async function fetchTrendData() {
    try {
      let startDate = trendStartDate
      let endDate = trendEndDate

      if (!startDate || !endDate) {
        if (trendPeriod === 'daily') {
          startDate = format(subDays(new Date(), 6), 'yyyy-MM-dd')
          endDate = getLocalDateString()
        } else if (trendPeriod === 'weekly') {
          startDate = format(subDays(new Date(), 27), 'yyyy-MM-dd')
          endDate = getLocalDateString()
        } else {
          startDate = format(startOfMonth(new Date()), 'yyyy-MM-dd')
          endDate = format(endOfMonth(new Date()), 'yyyy-MM-dd')
        }
      }

      const { data: logs } = await supabase
        .from('stock_log')
        .select('created_at, change_qty')
        .gte('created_at', `${startDate}T00:00:00`)
        .lte('created_at', `${endDate}T23:59:59`)
        .order('created_at', { ascending: true })

      const dateMap = new Map<string, number>()
      const today = new Date()
      const days = trendPeriod === 'daily' ? 7 : trendPeriod === 'weekly' ? 28 : 30
      
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const key = format(d, 'yyyy-MM-dd')
        dateMap.set(key, 0)
      }

      ;(logs || []).forEach((log: any) => {
        const date = log.created_at?.split('T')[0] || ''
        if (dateMap.has(date)) {
          dateMap.set(date, (dateMap.get(date) || 0) + Number(log.change_qty || 0))
        }
      })

      const chartData = Array.from(dateMap.entries()).map(([date, change]) => ({
        date: format(new Date(date + 'T00:00:00'), trendPeriod === 'monthly' ? 'MMM dd' : 'MMM dd'),
        change: Number(change),
      }))

      setChartData(chartData)
    } catch (err) {
      console.error('Failed to load trend data', err)
    }
  }

  async function fetchTopProducts() {
    try {
      const { data: salesData } = await supabase
        .from('sales')
        .select('id, created_at, is_voided')
        .eq('is_voided', false)

      const saleIds = (salesData || []).map(s => s.id)
      const { data: itemsData } = saleIds.length > 0
        ? await supabase
            .from('sale_items')
            .select('product_id, product_name, quantity, subtotal')
            .in('sale_id', saleIds)
        : { data: [] }

      const productMap = new Map<string, { name: string; revenue: number; units: number }>()
      ;(itemsData || []).forEach((item: any) => {
        const key = item.product_id || item.product_name
        const existing = productMap.get(key) || { name: item.product_name, revenue: 0, units: 0 }
        existing.revenue += Number(item.subtotal || 0)
        existing.units += Number(item.quantity || 0)
        productMap.set(key, existing)
      })

      setTopProducts(
        Array.from(productMap.values())
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)
      )
    } catch (err) {
      console.error('Failed to load top products', err)
    }
  }

  async function fetchPeriodProfit() {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('amount, payment_method')
      
      if (error) throw error
      
      const totalExpenses = (data || []).reduce((sum, e) => sum + Number(e.amount), 0)
      setPeriodProfit(totalExpenses)
    } catch (err) {
      console.error('Failed to load period profit', err)
    }
  }

  async function handleBulkStockSave() {
    setSavingBulk(true)
    try {
      const updates = Object.entries(bulkStocks).map(([productId, vals]) => ({
        id: productId,
        initial_stock: parseFloat(vals.initial) || 0,
        stock_qty: parseFloat(vals.qty) || 0,
      }))

      for (const update of updates) {
        const { error } = await supabase
          .from('products')
          .update({ initial_stock: update.initial_stock, stock_qty: update.stock_qty })
          .eq('id', update.id)
        if (error) throw error
      }

      toast.success('Bulk stock updated successfully')
      setBulkStocks({})
      fetchProducts()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update bulk stock'
      toast.error(`❌ ${message}`)
    } finally {
      setSavingBulk(false)
    }
  }

  function initializeBulkStocks() {
    const stocks: Record<string, { initial: string; qty: string }> = {}
    products.forEach(p => {
      stocks[p.id] = {
        initial: (p.initial_stock || 0).toString(),
        qty: p.stock_qty.toString(),
      }
    })
    setBulkStocks(stocks)
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

  const totalInitialStockValue = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    if (variants.length === 0) return sum + (p.initial_stock || 0) * p.price
    return sum + variants.reduce((vSum, v) => vSum + (v.initial_stock || 0) * v.price, 0)
  }, 0)

  const totalSoldValue = parentProducts.reduce((sum, p) => {
    const variants = getVariants(p.id)
    if (variants.length === 0) return sum + (p.soldUnits || 0) * p.price
    return sum + variants.reduce((vSum, v) => vSum + (v.soldUnits || 0) * v.price, 0)
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
              className={`px-4 py-2 rounded-full text-sm font-semibold ${activeView === 'inventory' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              onClick={() => setActiveView('inventory')}
            >
              Inventory
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-full text-sm font-semibold ${activeView === 'analysis' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              onClick={() => setActiveView('analysis')}
            >
              Stock Analysis
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-full text-sm font-semibold ${activeView === 'settings' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              onClick={() => { setActiveView('settings'); initializeBulkStocks() }}
            >
              Stock Settings
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-full text-sm font-semibold ${activeView === 'trends' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              onClick={() => setActiveView('trends')}
            >
              Trends
            </button>
          </div>
          <div className="text-sm text-slate-500">
            Showing {activeView === 'inventory' ? 'inventory controls and stock status' : activeView === 'analysis' ? 'profitability, sales, and stock analytics' : activeView === 'settings' ? 'bulk stock management' : 'stock movement and trends'}.
          </div>
        </div>

        {activeView === 'inventory' ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Products</p><p className="text-xl font-bold text-slate-900">{products.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Initial Stock</p><p className="text-xl font-bold text-slate-900">{totalInitialStock.toLocaleString()}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Initial Stock Value</p><p className="text-xl font-bold text-brand-600">{formatMoney(totalInitialStockValue)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Current Stock Value</p><p className="text-xl font-bold text-emerald-600">{formatMoney(totalValue)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Stock Sold Value</p><p className="text-xl font-bold text-amber-600">{formatMoney(totalSoldValue)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Profit</p><p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(totalProfit)}</p></div>
            </div>

            {/* Category Values */}
            <div className="card p-5">
              <h3 className="font-bold text-slate-900 mb-3">Value by Category</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(categoryValues).map(([cat, data]) => (
                  <div key={cat} className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
                    <div><p className="text-sm font-medium text-slate-700">{cat}</p><p className="text-xs text-slate-400">{data.qty} units</p></div>
                    <p className="text-sm font-bold text-slate-900">{formatMoney(data.value)}</p>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProducts.length === 0 ? (
                <div className="col-span-full"><p className="text-slate-500 text-center py-12">No products match filters</p></div>
              ) : (
              filteredProducts.map(product => {
                const variants = getVariants(product.id)
                const aggregateStock = getAggregateStock(product)
                const isLow = aggregateStock <= product.stock_alert && aggregateStock > 0
                const isOut = aggregateStock === 0
                return (
                  <div key={product.id} className="card p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedProduct(product)}>
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
                )
              })
              )}
            </div>
          </>
        ) : activeView === 'analysis' ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Revenue</p><p className="text-xl font-bold text-brand-600">{formatMoney(totalSoldUnits > 0 ? totalProfit + products.reduce((sum, p) => sum + p.soldCost, 0) : 0)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Profit</p><p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(totalProfit)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Profit Margin</p><p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{products.reduce((sum, p) => sum + p.soldRevenue, 0) > 0 ? `${((totalProfit / products.reduce((sum, p) => sum + p.soldRevenue, 0)) * 100).toFixed(1)}%` : '0.0%'}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Items Sold</p><p className="text-xl font-bold text-slate-900">{totalSoldUnits.toLocaleString()}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Loss Making</p><p className="text-xl font-bold text-red-600">{inventoryProducts.filter(p => p.profit < 0 && p.soldUnits > 0).length}</p></div>
            </div>

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

            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="py-3 px-4 text-left">Product</th>
                      <th className="py-3 px-4 text-right">Initial Stock</th>
                      <th className="py-3 px-4 text-right">Items Sold</th>
                      <th className="py-3 px-4 text-right">Current Stock</th>
                      <th className="py-3 px-4 text-right">Remaining Potential</th>
                      <th className="py-3 px-4 text-right">Expected Profit</th>
                      <th className="py-3 px-4 text-right">Profit So Far</th>
                      <th className="py-3 px-4 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAnalysis.length === 0 ? (
                      <tr><td colSpan={8} className="py-8 text-center text-slate-500">No products match analysis filters</td></tr>
                    ) : (
                      filteredAnalysis.map(product => {
                        const isProfitable = product.profit > 0
                        const isLoss = product.profit < 0
                        return (
                          <tr key={product.id} className="hover:bg-slate-50/60">
                            <td className="py-3 px-4">
                              <p className="font-semibold text-slate-900">{formatProductName(product)}</p>
                              <p className="text-xs text-slate-500">Sold: {product.soldUnits.toLocaleString()} {product.unit} • Stock: {product.stock_qty.toLocaleString()} {product.unit}</p>
                            </td>
                            <td className="py-3 px-4 text-right text-slate-600">{(product.initial_stock || 0).toLocaleString()} {product.unit}</td>
                            <td className="py-3 px-4 text-right font-semibold text-slate-900">{product.soldUnits.toLocaleString()}</td>
                            <td className="py-3 px-4 text-right text-slate-600">{product.stock_qty.toLocaleString()} {product.unit}</td>
                            <td className="py-3 px-4 text-right text-amber-600">{formatMoney(product.remainingPotentialProfit)}</td>
                            <td className="py-3 px-4 text-right text-slate-900">{formatMoney(product.totalExpectedProfit)}</td>
                            <td className={`py-3 px-4 text-right ${isProfitable ? 'text-emerald-600' : isLoss ? 'text-red-600' : 'text-amber-600'}`}>{formatMoney(product.profit)}</td>
                            <td className="py-3 px-4 text-right text-slate-900">{product.soldRevenue > 0 ? `${product.profitMargin.toFixed(1)}%` : '0.0%'}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : activeView === 'settings' ? (
          <div className="space-y-6">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-900">Bulk Stock Initialization</h3>
                  <p className="text-xs text-slate-500 mt-1">Set initial stock and current quantity for all products at once.</p>
                </div>
                <button onClick={handleBulkStockSave} disabled={savingBulk} className="btn-primary inline-flex items-center gap-2">
                  <Save className="w-4 h-4" /> {savingBulk ? 'Saving...' : 'Save All'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-slate-500 text-xs"><th className="py-2 px-3 text-left">Product</th><th className="py-2 px-3 text-left">Unit</th><th className="py-2 px-3 text-right">Current Stock</th><th className="py-2 px-3 text-right">Initial Stock</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {products.map(product => (
                      <tr key={product.id} className="hover:bg-slate-50/60">
                        <td className="py-2 px-3 text-slate-900 font-medium">{product.name}</td>
                        <td className="py-2 px-3 text-slate-600">{product.unit}</td>
                        <td className="py-2 px-3 text-right">
                          <input type="number" className="input w-24 text-right text-xs py-1" value={bulkStocks[product.id]?.qty || '0'} onChange={e => setBulkStocks({ ...bulkStocks, [product.id]: { ...bulkStocks[product.id], qty: e.target.value } })} />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <input type="number" className="input w-24 text-right text-xs py-1" value={bulkStocks[product.id]?.initial || '0'} onChange={e => setBulkStocks({ ...bulkStocks, [product.id]: { ...bulkStocks[product.id], initial: e.target.value } })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="card p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <select className="input w-auto" value={trendPeriod} onChange={e => setTrendPeriod(e.target.value as 'daily' | 'weekly' | 'monthly')}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input type="date" value={trendStartDate} onChange={e => setTrendStartDate(e.target.value)} className="input" />
                  <span className="text-slate-400">to</span>
                  <input type="date" value={trendEndDate} onChange={e => setTrendEndDate(e.target.value)} className="input" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Chart Period Profit</p><p className="text-xl font-bold text-brand-600">{formatMoney(periodProfit)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Products</p><p className="text-xl font-bold text-slate-900">{products.length}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Top Performer</p><p className="text-sm font-bold text-slate-900 truncate">{topProducts[0]?.name || 'N/A'}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Top Revenue</p><p className="text-xl font-bold text-slate-900">{formatMoney(topProducts[0]?.revenue || 0)}</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Units Sold</p><p className="text-xl font-bold text-slate-900">{topProducts.reduce((sum, p) => sum + p.units, 0).toLocaleString()}</p></div>
            </div>

            <div className="card p-5">
              <h3 className="font-bold text-slate-900 mb-4">Stock Movement</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="change" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-5">
              <h3 className="font-bold text-slate-900 mb-3">Top Performing Products</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-slate-500 text-xs"><th className="py-2 px-3 text-left">Product</th><th className="py-2 px-3 text-right">Units Sold</th><th className="py-2 px-3 text-right">Revenue</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {topProducts.map((product, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="py-2 px-3 text-slate-900 font-medium">{product.name}</td>
                        <td className="py-2 px-3 text-right text-slate-600">{product.units.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-semibold text-slate-900">{formatMoney(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        title={selectedProduct ? formatProductName(selectedProduct) : ''}
        description="Product stock and profit breakdown"
        size="lg"
        footer={
          <div className="flex justify-end">
            <button onClick={() => setSelectedProduct(null)} className="btn-secondary">Close</button>
          </div>
        }
      >
        {selectedProduct && (() => {
          const variants = getVariants(selectedProduct.id)
          const aggregateStock = getAggregateStock(selectedProduct)
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Selling price</p>
                  <p className="text-sm font-semibold text-slate-900">{formatMoney(selectedProduct.price, settings.currency)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Buying price</p>
                  <p className="text-sm font-semibold text-slate-900">{formatMoney(selectedProduct.cost_price ?? 0, settings.currency)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Margin/unit</p>
                  <p className="text-sm font-semibold text-slate-900">{formatMoney((selectedProduct.price || 0) - (selectedProduct.cost_price ?? 0), settings.currency)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Initial stock</p>
                  <p className="text-sm font-semibold text-slate-900">{(selectedProduct.initial_stock || 0).toLocaleString()} {selectedProduct.unit}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Current stock</p>
                  <p className="text-sm font-semibold text-slate-900">{aggregateStock.toLocaleString()} {selectedProduct.unit}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Low stock alert</p>
                  <p className="text-sm font-semibold text-slate-900">{selectedProduct.stock_alert} {selectedProduct.unit}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Sold units</p>
                  <p className="text-sm font-semibold text-slate-900">{selectedProduct.soldUnits.toLocaleString()}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Profit so far</p>
                  <p className={`text-sm font-semibold ${selectedProduct.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(selectedProduct.profit, settings.currency)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-1">Expected profit</p>
                  <p className="text-sm font-semibold text-slate-900">{formatMoney(selectedProduct.totalExpectedProfit, settings.currency)}</p>
                </div>
              </div>

              {variants.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-700 uppercase mb-3">Variant breakdown</p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-slate-50 text-slate-500 text-xs"><th className="py-2 px-3 text-left">Variant</th><th className="py-2 px-3 text-left">Stock</th><th className="py-2 px-3 text-left">Initial</th><th className="py-2 px-3 text-right">Sold</th><th className="py-2 px-3 text-right">Expected profit</th><th className="py-2 px-3 text-right">Remaining</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {variants.map(v => {
                          const vMargin = (v.price || 0) - (v.cost_price ?? 0)
                          const vSold = v.soldUnits || 0
                          const vStock = v.stock_qty || 0
                          const vInitial = v.initial_stock || 0
                          const vExpected = vInitial * vMargin
                          const vRemaining = vStock * vMargin
                          return (
                            <tr key={v.id} className="hover:bg-slate-50/60">
                              <td className="py-2 px-3 text-slate-900 font-medium">{formatProductName(v)}</td>
                              <td className="py-2 px-3 text-slate-600">{vStock.toLocaleString()} {v.unit}</td>
                              <td className="py-2 px-3 text-slate-600">{vInitial.toLocaleString()} {v.unit}</td>
                              <td className="py-2 px-3 text-right text-slate-600">{vSold.toLocaleString()}</td>
                              <td className="py-2 px-3 text-right text-slate-900">{formatMoney(vExpected, settings.currency)}</td>
                              <td className="py-2 px-3 text-right text-amber-600">{formatMoney(vRemaining, settings.currency)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </Modal>
    </RoleGuard>
  )
}
