'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { SessionUser, ShopSettings, Product, Category } from '@/types'
import { getSession } from '@/lib/auth'
import { formatMoney } from '@/lib/format'
import { useShopSettings } from '@/hooks/useShopSettings'
import { useToast } from '@/context/ToastContext'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PageHeader } from '@/components/PageHeader'
import { Modal } from '@/components/Modal'
import { RoleGuard } from '@/components/RoleGuard'
import { Store, Trash2, Search, Plus, Edit3, Save, RefreshCw, AlertTriangle } from 'lucide-react'
import { validateCategoryForm, validateProductForm } from '@/lib/validators'

export default function SettingsPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { settings, loading, saveSettings, refresh } = useShopSettings()
  const [form, setForm] = useState<ShopSettings>({
    shop_name: '',
    shop_address: '',
    shop_phone: '',
    currency: 'KSh',
    receipt_footer: '',
    tax_rate: 0,
  })
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  type SettingsTab = 'general' | 'products' | 'categories'

  const [productForm, setProductForm] = useState({
    name: '',
    variety: '',
    description: '',
    category_id: '',
    parent_product_id: '',
    price: '0.00',
    unit: 'piece',
    stock_qty: '0',
    stock_alert: '10',
    is_active: true,
  })
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' })
  const [productErrors, setProductErrors] = useState<Record<string, string>>({})
  const [categoryErrors, setCategoryErrors] = useState<Record<string, string>>({})
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [productSearch, setProductSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const toast = useToast()
  const supabase = createClient()

  useEffect(() => {
    const session = getSession()
    if (!session) {
      router.push('/login')
      return
    }
    setUser(session)
  }, [])

  useEffect(() => {
    if (!loading && settings) {
      setForm({
        shop_name: settings.shop_name || '',
        shop_address: settings.shop_address || '',
        shop_phone: settings.shop_phone || '',
        currency: settings.currency || 'KSh',
        receipt_footer: settings.receipt_footer || '',
        tax_rate: settings.tax_rate || 0,
      })
    }
  }, [settings, loading])

  useEffect(() => {
    async function loadCatalog() {
      setCatalogLoading(true)
      await Promise.all([fetchCategories(), fetchProducts()])
      setCatalogLoading(false)
    }

    loadCatalog()
  }, [])

  useEffect(() => {
    if (categories.length && productModalOpen && !productForm.category_id) {
      setProductForm(prev => ({ ...prev, category_id: categories[0].id }))
    }
  }, [categories, productModalOpen, productForm.category_id])

  async function handleSave() {
    setSaving(true)
    const result = await saveSettings(form)
    if (!result.ok) {
      toast.error(result.error || 'Failed to save settings')
    } else {
      toast.success('Settings saved')
      refresh()
    }
    setSaving(false)
  }

  async function resetSales() {
    if (!confirm('Delete all sales records and daily summaries? This cannot be undone.')) return
    if (!confirm('This will remove all transaction history. Are you sure?')) return
    try {
      await Promise.all([
        supabase.from('sale_items').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('daily_sales_summary').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      ])
      toast.success('All sales and transactions reset')
      refresh()
    } catch (err) {
      toast.error('Failed to reset sales')
    }
  }

  async function resetExpenses() {
    if (!confirm('Delete all expense records? This cannot be undone.')) return
    try {
      await supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      toast.success('All expenses reset')
      refresh()
    } catch (err) {
      toast.error('Failed to reset expenses')
    }
  }

  async function resetDrawer() {
    if (!confirm('Delete all drawer balance records? This cannot be undone.')) return
    try {
      await supabase.from('drawer_balances').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      toast.success('All drawer balances reset')
      refresh()
    } catch (err) {
      toast.error('Failed to reset drawer balances')
    }
  }

  async function resetAllMetrics() {
    if (!confirm('Reset ALL metrics? This will delete sales, expenses, and drawer records. Products and stock will NOT be affected.')) return
    if (!confirm('This cannot be undone. Are you absolutely sure?')) return
    try {
      await Promise.all([
        supabase.from('sale_items').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('daily_sales_summary').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('drawer_balances').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      ])
      toast.success('All metrics reset - products and stock preserved')
      refresh()
    } catch (err) {
      toast.error('Failed to reset metrics')
    }
  }

  async function fetchCategories() {
    try {
      const { data, error } = await supabase.from('categories').select('*').order('name')
      if (error) throw error
      setCategories(data || [])
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load categories'
      setError(message)
      toast.error(message)
    }
  }

  async function fetchProducts() {
    try {
      const { data, error } = await supabase.from('products').select('*, category:categories(name)').order('name')
      if (error) throw error
      setProducts((data || []) as Product[])
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load products'
      setError(message)
      toast.error(message)
    }
  }

  function openNewProduct(parentId?: string, parentCategoryId?: string) {
    setEditingProduct(null)
    setProductForm({
      name: '',
      variety: '',
      description: '',
      category_id: categories.find(category => category.id === parentCategoryId)?.id || categories[0]?.id || '',
      parent_product_id: parentId || '',
      price: '0.00',
      unit: 'piece',
      stock_qty: '0',
      stock_alert: '10',
      is_active: true,
    })
    setProductErrors({})
    setProductModalOpen(true)
  }

  function openEditProduct(product: Product) {
    setEditingProduct(product)
    setProductForm({
      name: product.name,
      variety: product.variety || '',
      description: product.description || '',
      category_id: product.category_id || categories[0]?.id || '',
      parent_product_id: product.parent_product_id || '',
      price: product.price.toString(),
      unit: product.unit,
      stock_qty: product.stock_qty.toString(),
      stock_alert: product.stock_alert.toString(),
      is_active: product.is_active,
    })
    setProductErrors({})
    setProductModalOpen(true)
  }

  async function handleSaveProduct() {
    const validation = validateProductForm(productForm)
    if (!validation.isValid) {
      setProductErrors(Object.fromEntries(validation.errors.map(error => [error.field, error.message])))
      return
    }

    const payload = {
      name: productForm.name.trim(),
      variety: productForm.variety.trim() || null,
      description: productForm.description.trim() || null,
      category_id: productForm.category_id || null,
      parent_product_id: productForm.parent_product_id || null,
      price: parseFloat(productForm.price),
      unit: productForm.unit.trim(),
      stock_qty: parseFloat(productForm.stock_qty),
      stock_alert: parseInt(productForm.stock_alert, 10),
      is_active: productForm.is_active,
    }

    try {
      if (editingProduct) {
        const { error } = await supabase.from('products').update(payload).eq('id', editingProduct.id).single()
        if (error) throw error
        toast.success('Product updated successfully')
      } else {
        const { error } = await supabase.from('products').insert([payload])
        if (error) throw error
        toast.success('Product created successfully')
      }
      setProductModalOpen(false)
      fetchProducts()
    } catch (error) {
      toast.error('Unable to save product')
      console.error(error)
    }
  }

  async function toggleProductStatus(product: Product) {
    try {
      const { error } = await supabase.from('products').update({ is_active: !product.is_active }).eq('id', product.id).single()
      if (error) throw error
      toast.success(`${product.is_active ? 'Deactivated' : 'Activated'} product`)
      fetchProducts()
    } catch (error) {
      toast.error('Unable to update product status')
      console.error(error)
    }
  }

  function openNewCategory() {
    setEditingCategory(null)
    setCategoryForm({ name: '', description: '' })
    setCategoryErrors({})
    setCategoryModalOpen(true)
  }

  function openEditCategory(category: Category) {
    setEditingCategory(category)
    setCategoryForm({ name: category.name, description: category.description || '' })
    setCategoryErrors({})
    setCategoryModalOpen(true)
  }

  async function handleSaveCategory() {
    const validation = validateCategoryForm(categoryForm)
    if (!validation.isValid) {
      setCategoryErrors(Object.fromEntries(validation.errors.map(error => [error.field, error.message])))
      return
    }

    const payload = {
      name: categoryForm.name.trim(),
      description: categoryForm.description.trim() || null,
    }

    try {
      if (editingCategory) {
        const { error } = await supabase.from('categories').update(payload).eq('id', editingCategory.id).single()
        if (error) throw error
        toast.success('Category updated successfully')
      } else {
        const { error } = await supabase.from('categories').insert([payload])
        if (error) throw error
        toast.success('Category created successfully')
      }
      setCategoryModalOpen(false)
      fetchCategories()
    } catch (error) {
      toast.error('Unable to save category')
      console.error(error)
    }
  }

  async function toggleCategoryStatus(category: Category) {
    try {
      const { error } = await supabase.from('categories').update({ is_active: !category.is_active }).eq('id', category.id).single()
      if (error) throw error
      toast.success(`${category.is_active ? 'Deactivated' : 'Activated'} category`)
      fetchCategories()
    } catch (error) {
      toast.error('Unable to update category')
      console.error(error)
    }
  }

  const productOptions = ['all', ...Array.from(new Set(products.map(product => ((product.category as { name?: string })?.name || 'Uncategorized'))))]

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase()
    return products.filter(product => {
      const matchesSearch = !query || product.name.toLowerCase().includes(query) || (product.variety || '').toLowerCase().includes(query) || (product.description || '').toLowerCase().includes(query) || ((product.category as { name?: string })?.name || 'Uncategorized').toLowerCase().includes(query)
      const matchesCategory = categoryFilter === 'all' || ((product.category as { name?: string })?.name || 'Uncategorized') === categoryFilter
      return matchesSearch && matchesCategory
    })
  }, [products, productSearch, categoryFilter])

  const selectedVariants = useMemo(() => {
    if (!selectedProduct) return []
    return products.filter(product => product.parent_product_id === selectedProduct.id)
  }, [products, selectedProduct])

  if (loading || catalogLoading) return <div className="flex items-center justify-center py-20"><LoadingSpinner /></div>

  return (
    <RoleGuard allowed={['owner']}>
      <div className="space-y-6">
        <PageHeader title="Settings" description="Shop configuration" />

        <div className="flex flex-wrap gap-2 rounded-2xl bg-white p-2 shadow-sm border border-slate-200">
          {[
            { id: 'general', label: 'Shop' },
            { id: 'products', label: 'Products' },
            { id: 'categories', label: 'Categories' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as SettingsTab)}
              className={`btn-sm ${activeTab === tab.id ? 'bg-emerald-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'general' && (
          <div className="space-y-6">
            <div className="card p-6">
              <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2"><Store className="w-5 h-5" /> Shop Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="label">Shop Name</label><input className="input" value={form.shop_name} onChange={e => setForm({ ...form, shop_name: e.target.value })} /></div>
                <div><label className="label">Address</label><input className="input" value={form.shop_address} onChange={e => setForm({ ...form, shop_address: e.target.value })} /></div>
                <div><label className="label">Phone</label><input className="input" value={form.shop_phone} onChange={e => setForm({ ...form, shop_phone: e.target.value })} /></div>
                <div><label className="label">Currency</label><input className="input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} /></div>
                <div><label className="label">Tax Rate (%)</label><input type="number" className="input" value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: parseFloat(e.target.value) || 0 })} /></div>
                <div className="md:col-span-2"><label className="label">Receipt Footer</label><textarea className="input" rows={3} value={form.receipt_footer} onChange={e => setForm({ ...form, receipt_footer: e.target.value })} /></div>
              </div>
              <button onClick={handleSave} disabled={saving} className="btn-primary mt-4">{saving ? 'Saving...' : 'Save Settings'}</button>
            </div>

            <div className="card p-6 border-red-100 bg-red-50/40">
              <div className="flex items-start gap-3 mb-4">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-slate-900">Reset Metrics</h3>
                  <p className="text-sm text-slate-600 mt-1">Clear business data while preserving your product catalog and stock quantities. These actions cannot be undone.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button onClick={resetSales} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 inline-flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Reset Sales
                </button>
                <button onClick={resetExpenses} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 inline-flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Reset Expenses
                </button>
                <button onClick={resetDrawer} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 inline-flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Reset Drawer
                </button>
                <button onClick={resetAllMetrics} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50 inline-flex items-center justify-center gap-2 font-semibold">
                  <RefreshCw className="w-4 h-4" /> Reset All Metrics
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-900">Categories</h3>
                <p className="text-sm text-slate-500">Manage product categories used in the catalog.</p>
              </div>
              <button onClick={openNewCategory} className="btn-primary inline-flex items-center gap-2 text-sm">
                <Plus className="w-4 h-4" /> Add Category
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-head">Name</th>
                    <th className="table-head">Status</th>
                    <th className="table-head text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categories.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500">No categories found.</td>
                    </tr>
                  ) : (
                    categories.map(category => (
                      <tr key={category.id} className="table-row-hover">
                        <td className="table-cell">{category.name}</td>
                        <td className="table-cell">
                          <span className={category.is_active ? 'badge badge-active' : 'badge badge-inactive'}>
                            {category.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="table-cell text-right space-x-2">
                          <button onClick={() => openEditCategory(category)} className="text-slate-600 hover:text-brand-600"><Edit3 className="inline w-4 h-4" /></button>
                          <button onClick={() => toggleCategoryStatus(category)} className="text-slate-600 hover:text-red-600"><Trash2 className="inline w-4 h-4" /></button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'products' && (
          <div className="card p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-900">Products</h3>
                <p className="text-sm text-slate-500">Add and update catalog items used in the POS.</p>
              </div>
              <button onClick={() => openNewProduct()} className="btn-primary inline-flex items-center gap-2 text-sm">
                <Plus className="w-4 h-4" /> Add Product
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 text-slate-400 w-4 h-4" />
                <input
                  type="search"
                  placeholder="Search products..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="input pl-10 w-full"
                />
              </div>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input w-full">
                {productOptions.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-head">Name</th>
                    <th className="table-head">Category</th>
                    <th className="table-head">Price</th>
                    <th className="table-head">Status</th>
                    <th className="table-head text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">No products found.</td>
                    </tr>
                  ) : (
                    filteredProducts.map(product => (
                      <tr
                        key={product.id}
                        className="table-row-hover cursor-pointer"
                        onClick={() => setSelectedProduct(product)}
                      >
                        <td className="table-cell">{product.name}</td>
                        <td className="table-cell">{((product.category as { name?: string })?.name) || 'Uncategorized'}</td>
                        <td className="table-cell">{formatMoney(product.price, form.currency)}</td>
                        <td className="table-cell">
                          <span className={product.is_active ? 'badge badge-active' : 'badge badge-inactive'}>
                            {product.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="table-cell text-right space-x-2">
                          <button onClick={e => { e.stopPropagation(); openEditProduct(product) }} className="text-slate-600 hover:text-brand-600"><Edit3 className="inline w-4 h-4" /></button>
                          <button onClick={e => { e.stopPropagation(); toggleProductStatus(product) }} className="text-slate-600 hover:text-red-600"><Trash2 className="inline w-4 h-4" /></button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {selectedProduct && (
              <div className="card mt-6 p-6 border-emerald-100 bg-emerald-50/40">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900">{selectedProduct.name}</h4>
                    <p className="text-sm text-slate-600">Click any product row to view variant details.</p>
                  </div>
                  <button onClick={() => openNewProduct(selectedProduct.parent_product_id || selectedProduct.id, selectedProduct.category_id)} className="btn-secondary inline-flex items-center gap-2 text-sm">
                    <Plus className="w-4 h-4" /> Add Variant
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Category</p>
                    <p className="text-sm text-slate-900">{((selectedProduct.category as { name?: string })?.name) || 'Uncategorized'}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Unit</p>
                    <p className="text-sm text-slate-900">{selectedProduct.unit}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Quantity</p>
                    <p className="text-sm text-slate-900">{selectedProduct.stock_qty} {selectedProduct.unit}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Low stock alert</p>
                    <p className="text-sm text-slate-900">{selectedProduct.stock_alert} {selectedProduct.unit}</p>
                  </div>
                </div>

                {selectedProduct.parent_product_id && (
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Variant of</p>
                    <p className="text-sm text-slate-900">{products.find(p => p.id === selectedProduct.parent_product_id)?.name || 'Parent product'}</p>
                  </div>
                )}

                <div>
                  <h5 className="font-semibold text-slate-900 mb-3">Variants</h5>
                  {selectedVariants.length === 0 ? (
                    <p className="text-sm text-slate-500">No variants are attached to this product yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="table-head">Name</th>
                            <th className="table-head">Unit</th>
                            <th className="table-head">Qty</th>
                            <th className="table-head">Price</th>
                            <th className="table-head text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedVariants.map(variant => (
                            <tr key={variant.id} className="table-row-hover">
                              <td className="table-cell">{variant.name}</td>
                              <td className="table-cell">{variant.unit}</td>
                              <td className="table-cell">{variant.stock_qty}</td>
                              <td className="table-cell">{formatMoney(variant.price, form.currency)}</td>
                              <td className="table-cell text-right">
                                <button onClick={() => openEditProduct(variant)} className="text-slate-600 hover:text-brand-600"><Edit3 className="inline w-4 h-4" /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <Modal
          isOpen={productModalOpen}
          onClose={() => setProductModalOpen(false)}
          title={editingProduct ? 'Edit Product' : 'Add Product'}
          description="Create or update a catalog item. Use the unit field to describe measurements like ml, ltr, or pack."
          footer={
            <div className="flex justify-end gap-3">
              <button onClick={() => setProductModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSaveProduct} className="btn-primary inline-flex items-center gap-2">
                <Save className="w-4 h-4" /> {editingProduct ? 'Update' : 'Save'}
              </button>
            </div>
          }
          size="xl"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Product name</span>
              <input value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} className="input w-full" />
              {productErrors.name && <p className="text-xs text-red-600">{productErrors.name}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Category</span>
              <select value={productForm.category_id} onChange={e => setProductForm({ ...productForm, category_id: e.target.value })} className="input w-full">
                <option value="">Uncategorized</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Description</span>
              <textarea value={productForm.description} onChange={e => setProductForm({ ...productForm, description: e.target.value })} className="input h-24 w-full resize-none" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Variety / Variant name</span>
              <input value={productForm.variety} onChange={e => setProductForm({ ...productForm, variety: e.target.value })} className="input w-full" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Price</span>
              <input type="number" step="0.01" min="0" value={productForm.price} onChange={e => setProductForm({ ...productForm, price: e.target.value })} className="input w-full" />
              {productErrors.price && <p className="text-xs text-red-600">{productErrors.price}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Unit</span>
              <input value={productForm.unit} onChange={e => setProductForm({ ...productForm, unit: e.target.value })} className="input w-full" />
              {productErrors.unit && <p className="text-xs text-red-600">{productErrors.unit}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Stock quantity</span>
              <input type="text" placeholder="e.g. 500 ml, 1.5 ltr, 12 pack" value={productForm.stock_qty} onChange={e => setProductForm({ ...productForm, stock_qty: e.target.value })} className="input w-full" />
              {productErrors.stock_qty && <p className="text-xs text-red-600">{productErrors.stock_qty}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Low stock alert</span>
              <input type="number" min="0" value={productForm.stock_alert} onChange={e => setProductForm({ ...productForm, stock_alert: e.target.value })} className="input w-full" />
              {productErrors.stock_alert && <p className="text-xs text-red-600">{productErrors.stock_alert}</p>}
            </label>
            <label className="flex items-center gap-3 sm:col-span-2">
              <input type="checkbox" checked={productForm.is_active} onChange={e => setProductForm({ ...productForm, is_active: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              <span className="text-sm text-slate-700">Mark as active</span>
            </label>
          </div>
        </Modal>

        <Modal
          isOpen={categoryModalOpen}
          onClose={() => setCategoryModalOpen(false)}
          title={editingCategory ? 'Edit Category' : 'Add Category'}
          description="Create or update the category used by products."
          footer={
            <div className="flex justify-end gap-3">
              <button onClick={() => setCategoryModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSaveCategory} className="btn-primary inline-flex items-center gap-2">
                <Save className="w-4 h-4" /> {editingCategory ? 'Update' : 'Save'}
              </button>
            </div>
          }
          size="md"
        >
          <div className="grid gap-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Category name</span>
              <input value={categoryForm.name} onChange={e => setCategoryForm({ ...categoryForm, name: e.target.value })} className="input w-full" />
              {categoryErrors.name && <p className="text-xs text-red-600">{categoryErrors.name}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Description</span>
              <textarea value={categoryForm.description} onChange={e => setCategoryForm({ ...categoryForm, description: e.target.value })} className="input h-28 w-full resize-none" />
            </label>
          </div>
        </Modal>

      </div>
    </RoleGuard>
  )
}