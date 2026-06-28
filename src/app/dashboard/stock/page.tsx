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
      const { data, error } = await supabase
        .from('products')
        .select('*, category:categories(name)')
        .eq('is_active', true)
        .order('name')

      if (error) {
        setError(error.message)
        toast.error(`❌ Failed to load inventory: ${error.message}`)
        setProducts([])
      } else {
        setProducts(data || [])
        if (data && data.length > 0) {
          const lowStockItems = data.filter(p => p.stock_qty <= p.stock_alert && p.stock_qty > 0)
          const outOfStock = data.filter(p => p.stock_qty === 0)
          if (lowStockItems.length > 0 || outOfStock.length > 0) {
            toast.warning(`⚠️ ${lowStockItems.length} low stock, ${outOfStock.length} out of stock`)
          }
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
  })), [products])

  const categories = Array.from(new Set(inventoryProducts.map(p => (p.category as { name?: string })?.name || 'Uncategorized')))

  const filteredProducts = useMemo(() => {
    return inventoryProducts.filter(p => {
      const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.variety ?? '').toLowerCase().includes(search.toLowerCase())
      const matchesCategory = categoryFilter === 'all' || (p.category as { name?: string })?.name === categoryFilter
      const matchesStock = stockFilter === 'all' || 
        (stockFilter === 'in_stock' && p.stock_qty > p.stock_alert) || 
        (stockFilter === 'low_stock' && p.stock_qty > 0 && p.stock_qty <= p.stock_alert) || 
        (stockFilter === 'out_of_stock' && p.stock_qty === 0)
      return matchesSearch && matchesCategory && matchesStock
    })
  }, [inventoryProducts, search, categoryFilter, stockFilter])

  const inStock = inventoryProducts.filter(p => p.stock_qty > p.stock_alert)
  const lowStock = inventoryProducts.filter(p => p.stock_qty <= p.stock_alert && p.stock_qty > 0)
  const outOfStock = inventoryProducts.filter(p => p.stock_qty === 0)
  const totalValue = inventoryProducts.reduce((sum, p) => sum + p.stock_qty * p.price, 0)

  const categoryValues = inventoryProducts.reduce((acc: Record<string, { qty: number; value: number }>, p) => {
    const cat = (p.category as { name?: string })?.name || 'Uncategorized'
    if (!acc[cat]) acc[cat] = { qty: 0, value: 0 }
    acc[cat].qty += p.stock_qty
    acc[cat].value += p.stock_qty * p.price
    return acc
  }, {})

  if (loading) return <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>
  if (error) return <div className="flex items-center justify-center py-20 text-center text-sm text-red-600">{error}</div>

  return (
    <RoleGuard allowed={['owner', 'cashier']}>
      <div className="space-y-6">
        <PageHeader title="Inventory" description="Manage stock and products" />

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Total Products</p><p className="text-xl font-bold text-slate-900">{products.length}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500 mb-1">In Stock</p><p className="text-xl font-bold text-emerald-600">{inStock.length}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500 mb-1">Low Stock</p><p className="text-xl font-bold text-amber-600">{lowStock.length}</p></div>
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
              const isLow = product.stock_qty <= product.stock_alert && product.stock_qty > 0
              const isOut = product.stock_qty === 0
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
                  <p className="text-xs text-slate-500 mb-3">{formatMoney(product.price, settings.currency)} • {product.stock_qty} {product.unit}</p>
                  <p className="text-xs text-slate-400 mb-2">Value: {formatMoney(product.stock_qty * product.price, settings.currency)}</p>
                </div>
              )
            })
          )}
        </div>
      </div>
    </RoleGuard>
  )
}