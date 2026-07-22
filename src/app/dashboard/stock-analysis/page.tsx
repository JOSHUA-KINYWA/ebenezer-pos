'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { SessionUser } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney, formatProductName } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { RoleGuard } from '@/components/RoleGuard'
import { TrendingUp, TrendingDown, Package, ChevronDown, ChevronUp, Search, RefreshCw } from 'lucide-react'

interface ProductStock {
  id: string
  name: string
  variety?: string
  unit: string
  cost_price: number
  price: number
  currentStock: number
  totalSold: number
  totalRevenue: number
  totalCost: number
  profit: number
  profitMargin: number
  stockLog: any[]
}

export default function StockAnalysisPage() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [products, setProducts] = useState<ProductStock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
  const [filterProfitability, setFilterProfitability] = useState('all')
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
    fetchStockAnalysis(session)
  }, [router])

  async function fetchStockAnalysis(sessionUser?: SessionUser) {
    setLoading(true)
    setError('')

    const session = sessionUser || getSession()
    if (!session) {
      setError('Session expired. Please sign in again.')
      setLoading(false)
      return
    }

    try {
      // Get all products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('id, name, variety, unit, cost_price, price, stock_qty, is_active')
        .eq('is_active', true)
        .order('name')

      if (productsError) throw productsError

      // Get non-voided sales, optionally scoped to the current cashier
      let salesQuery = supabase
        .from('sales')
        .select('id')
        .eq('is_voided', false)

      if (session.role === 'cashier') {
        salesQuery = salesQuery.eq('user_id', session.id)
      }

      const { data: salesData, error: salesError } = await salesQuery
      if (salesError) throw salesError

      const saleIds = (salesData || []).map(sale => sale.id)
      const { data: salesItems, error: salesItemsError } = saleIds.length > 0
        ? await supabase
            .from('sale_items')
            .select('product_id, product_name, quantity, unit_price, subtotal')
            .in('sale_id', saleIds)
        : { data: [], error: null }

      if (salesItemsError) throw salesItemsError

      // Get stock log for historical tracking
      const { data: stockLogData, error: stockLogError } = await supabase
        .from('stock_log')
        .select('product_id, change_qty, reason, note, created_at')
        .order('created_at', { ascending: false })

      if (stockLogError) throw stockLogError

      // Process data to calculate stock analysis
      const stockAnalysis = (productsData || []).map(product => {
        const productSales = (salesItems || []).filter(item => item.product_id === product.id)

        const totalSold = productSales.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
        const totalRevenue = productSales.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
        const costPerUnit = Number(product.cost_price) || 0
        const totalCost = totalSold * costPerUnit
        const profit = totalRevenue - totalCost
        const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0

        const logs = (stockLogData || []).filter(log => log.product_id === product.id)

        return {
          id: product.id,
          name: product.name,
          variety: product.variety,
          unit: product.unit,
          cost_price: costPerUnit,
          price: Number(product.price) || 0,
          currentStock: Number(product.stock_qty) || 0,
          totalSold,
          totalRevenue,
          totalCost,
          profit,
          profitMargin,
          stockLog: logs,
        }
      })

      // Filter by search and profitability
      const filtered = stockAnalysis.filter(product => {
        const matchesSearch = !search.trim() || 
          product.name.toLowerCase().includes(search.toLowerCase()) ||
          (product.variety && product.variety.toLowerCase().includes(search.toLowerCase()))

        const matchesProfitability = 
          filterProfitability === 'all' ||
          (filterProfitability === 'profitable' && product.profit > 0) ||
          (filterProfitability === 'breaking_even' && product.profit === 0) ||
          (filterProfitability === 'loss' && product.profit < 0) ||
          (filterProfitability === 'no_sales' && product.totalSold === 0)

        return matchesSearch && matchesProfitability
      })

      setProducts(filtered)
      setError('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load stock analysis'
      setError(message)
      toast.error(`❌ ${message}`)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  // Calculate summary stats
  const totalRevenue = products.reduce((sum, p) => sum + p.totalRevenue, 0)
  const totalCost = products.reduce((sum, p) => sum + p.totalCost, 0)
  const totalProfit = totalRevenue - totalCost
  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
  const totalItemsSold = products.reduce((sum, p) => sum + p.totalSold, 0)
  const profitableProducts = products.filter(p => p.profit > 0).length
  const lossProducts = products.filter(p => p.profit < 0 && p.totalSold > 0).length

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>
  if (error) return <div className="flex items-center justify-center py-20 text-center text-sm text-red-600">{error}</div>

  return (
    <RoleGuard allowed={['owner', 'cashier']}>
      <div className="space-y-6">
        <PageHeader 
          title="Stock Analysis & Profitability" 
          description="Track product profitability, sales volume, and stock levels"
          action={
            <button onClick={() => fetchStockAnalysis()} className="btn-secondary gap-2">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          }
        />

        {/* Summary Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="card p-4">
            <p className="text-xs text-slate-500 mb-1 font-semibold uppercase">Total Revenue</p>
            <p className="text-xl font-bold text-brand-600">{formatMoney(totalRevenue, settings.currency)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500 mb-1 font-semibold uppercase">Total Profit</p>
            <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatMoney(totalProfit, settings.currency)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500 mb-1 font-semibold uppercase">Profit Margin</p>
            <p className={`text-xl font-bold ${profitMargin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {profitMargin.toFixed(1)}%
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500 mb-1 font-semibold uppercase">Items Sold</p>
            <p className="text-xl font-bold text-slate-900">{totalItemsSold.toLocaleString()}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500 mb-1 font-semibold uppercase">Profitable Products</p>
            <p className="text-xl font-bold text-emerald-600">{profitableProducts} {lossProducts > 0 && <span className="text-xs text-red-600">(-{lossProducts})</span>}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search products..." 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                className="input pl-9 w-full" 
              />
            </div>
            <select 
              className="input w-auto" 
              value={filterProfitability} 
              onChange={e => setFilterProfitability(e.target.value)}
            >
              <option value="all">All Products</option>
              <option value="profitable">Profitable</option>
              <option value="breaking_even">Breaking Even</option>
              <option value="loss">Loss Making</option>
              <option value="no_sales">No Sales</option>
            </select>
          </div>
        </div>

        {/* Products Table */}
        <div className="card overflow-hidden">
          {products.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No products match your filters</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {products.map(product => (
                <div key={product.id}>
                  {/* Main Row */}
                  <div
                    onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                    className="p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <button className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                          {expandedProduct === product.id ? 
                            <ChevronUp className="w-5 h-5" /> : 
                            <ChevronDown className="w-5 h-5" />
                          }
                        </button>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {formatProductName({ name: product.name, variety: product.variety })}
                          </p>
                          <p className="text-xs text-slate-500">
                            {product.totalSold.toLocaleString()} sold • Stock: {product.currentStock} {product.unit}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-xs text-slate-500 mb-1">Revenue</p>
                          <p className="font-semibold text-slate-900">{formatMoney(product.totalRevenue, settings.currency)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500 mb-1">Cost</p>
                          <p className="font-semibold text-slate-900">{formatMoney(product.totalCost, settings.currency)}</p>
                        </div>
                        <div className={`text-right ${product.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          <p className="text-xs mb-1 font-semibold">Profit</p>
                          <p className="font-bold text-lg">
                            {product.profit >= 0 ? '+' : ''}{formatMoney(product.profit, settings.currency)}
                          </p>
                        </div>
                        <div className={`text-right min-w-[60px] ${product.profitMargin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          <p className="text-xs mb-1 font-semibold">Margin</p>
                          <p className="font-bold text-lg">{product.profitMargin.toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedProduct === product.id && (
                    <div className="bg-slate-50 p-4 border-t border-slate-100">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div>
                          <p className="text-xs text-slate-500 mb-1 font-semibold">Unit Price</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {formatMoney(product.price, settings.currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1 font-semibold">Cost Per Unit</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {formatMoney(product.cost_price, settings.currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1 font-semibold">Total Sold</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {product.totalSold.toLocaleString()} units
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1 font-semibold">Current Stock</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {product.currentStock.toLocaleString()} {product.unit}
                          </p>
                        </div>
                      </div>

                      {/* Profitability Indicator */}
                      {product.totalSold > 0 ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            {product.profit > 0 ? (
                              <>
                                <TrendingUp className="w-4 h-4 text-emerald-600" />
                                <span className="text-sm text-emerald-600 font-semibold">
                                  ✓ Profitable - Achieved {product.profitMargin.toFixed(1)}% margin
                                </span>
                              </>
                            ) : product.profit === 0 ? (
                              <>
                                <span className="w-4 h-4 text-amber-600 text-lg">─</span>
                                <span className="text-sm text-amber-600 font-semibold">
                                  ≈ Breaking Even
                                </span>
                              </>
                            ) : (
                              <>
                                <TrendingDown className="w-4 h-4 text-red-600" />
                                <span className="text-sm text-red-600 font-semibold">
                                  ✗ Loss Making - {Math.abs(product.profitMargin).toFixed(1)}% loss
                                </span>
                              </>
                            )}
                          </div>

                          {product.totalSold > 0 && (
                            <div className="text-xs text-slate-600 bg-white p-2 rounded border border-slate-200">
                              <p className="mb-1"><strong>Breakdown:</strong></p>
                              <p>• Revenue: {formatMoney(product.totalRevenue, settings.currency)} ({product.totalSold} × {formatMoney(product.price, settings.currency)})</p>
                              <p>• Cost: {formatMoney(product.totalCost, settings.currency)} ({product.totalSold} × {formatMoney(product.cost_price, settings.currency)})</p>
                              <p>• {product.profit >= 0 ? 'Gain' : 'Loss'}: {formatMoney(Math.abs(product.profit), settings.currency)}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-slate-500">
                          <Package className="w-4 h-4" />
                          <span className="text-sm">No sales recorded yet</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </RoleGuard>
  )
}
