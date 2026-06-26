'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Modal } from '@/components/Modal'
import { RoleGuard } from '@/components/RoleGuard'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useToast } from '@/context/ToastContext'
import { Product, Category } from '@/types'
import { validateProductForm } from '@/lib/validators'
import { formatMoney } from '@/lib/format'
import { Search, Plus, Edit3, Trash2, Save } from 'lucide-react'

interface ProductForm {
  name: string
  variety: string
  description: string
  category_id: string
  parent_product_id: string
  price: string
  unit: string
  stock_qty: string
  stock_alert: string
  is_active: boolean
}

const initialForm: ProductForm = {
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
}

export default function ProductsPage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductForm>(initialForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [variantsDraft, setVariantsDraft] = useState<ProductForm[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const toast = useToast()
  const supabase = createClient()

  useEffect(() => {
    const session = getSession()
    if (!session) {
      router.push('/login')
      return
    }
    fetchCategories()
    fetchProducts()
  }, [])

  useEffect(() => {
    if (categories.length && modalOpen && !form.category_id) {
      setForm(prev => ({ ...prev, category_id: categories[0].id }))
    }
  }, [categories, modalOpen, form.category_id])

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
    setLoading(true)
    try {
      const { data, error } = await supabase.from('products').select('*, category:categories(name)').order('name')
      if (error) throw error
      setProducts((data || []) as Product[])
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load products'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setForm({
      ...initialForm,
      category_id: categories[0]?.id ?? '',
      parent_product_id: '',
    })
    setErrors({})
    setEditingProduct(null)
  }

  function openNewProduct(parentId?: string, parentCategoryId?: string, parent?: Product) {
    setForm({
      ...initialForm,
      category_id: (parentCategoryId || categories[0]?.id) ?? '',
      parent_product_id: parentId || '',
      price: parent?.price?.toString() || initialForm.price,
      unit: parent?.unit || initialForm.unit,
      stock_qty: '0',
      stock_alert: parent?.stock_alert?.toString() || initialForm.stock_alert,
      name: '',
    })
    setErrors({})
    setVariantsDraft([])
    setEditingProduct(null)
    setModalOpen(true)
  }

  function openEditProduct(product: Product) {
    setEditingProduct(product)
    setForm({
      name: product.name || '',
      variety: product.variety || '',
      description: product.description || '',
      category_id: product.category_id || categories[0]?.id || '',
      parent_product_id: product.parent_product_id || '',
      price: product.price?.toString() || '0.00',
      unit: product.unit || 'piece',
      stock_qty: product.stock_qty?.toString() || '0',
      stock_alert: product.stock_alert?.toString() || '10',
      is_active: product.is_active,
    })
    setErrors({})
    setVariantsDraft([])
    setModalOpen(true)
  }

  function addVariantDraft() {
    const parentId = editingProduct?.parent_product_id || editingProduct?.id || form.parent_product_id || ''
    setVariantsDraft(prev => [
      ...prev,
      {
        name: `${form.name} variant`,
        variety: '',
        description: '',
        category_id: form.category_id,
        parent_product_id: parentId,
        price: form.price,
        unit: form.unit,
        stock_qty: '0',
        stock_alert: form.stock_alert,
        is_active: true,
      },
    ])
  }

  function updateVariantDraft(index: number, field: keyof ProductForm, value: string | boolean) {
    setVariantsDraft(prev => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))
  }

  function removeVariantDraft(index: number) {
    setVariantsDraft(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSaveProduct() {
    const validation = validateProductForm(form)
    if (!validation.isValid) {
      const nextErrors = Object.fromEntries(validation.errors.map(error => [error.field, error.message]))
      setErrors(nextErrors)
      return
    }

    const payload = {
      name: form.name.trim(),
      variety: form.variety.trim() || null,
      description: form.description.trim() || null,
      category_id: form.category_id || null,
      parent_product_id: form.parent_product_id || null,
      price: parseFloat(form.price),
      unit: form.unit.trim(),
      stock_qty: parseFloat(form.stock_qty),
      stock_alert: parseInt(form.stock_alert, 10),
      is_active: form.is_active,
    }

    try {
      if (editingProduct) {
        const { error } = await supabase.from('products').update(payload).eq('id', editingProduct.id).single()
        if (error) throw error
        if (variantsDraft.length > 0) {
          const variantParentId = form.parent_product_id || editingProduct.id
          const variantPayloads = variantsDraft.map(v => ({
            name: v.name.trim(),
            variety: v.variety.trim() || null,
            description: v.description.trim() || null,
            category_id: v.category_id || null,
            parent_product_id: variantParentId,
            price: parseFloat(v.price),
            unit: v.unit.trim(),
            stock_qty: parseFloat(v.stock_qty),
            stock_alert: parseInt(v.stock_alert, 10),
            is_active: v.is_active,
          }))
          const { error: vErr } = await supabase.from('products').insert(variantPayloads)
          if (vErr) throw vErr
        }
        toast.success('Product updated successfully')
      } else {
        // create parent product and then any variantsDraft with the created id
        const { data: newProduct, error } = await supabase.from('products').insert([payload]).select('id').single()
        if (error || !newProduct) throw error || new Error('Failed to create product')
        const parentId = newProduct.id
        if (variantsDraft.length > 0) {
          const variantPayloads = variantsDraft.map(v => ({
            name: v.name.trim(),
            variety: v.variety.trim() || null,
            description: v.description.trim() || null,
            category_id: v.category_id || null,
            parent_product_id: parentId,
            price: parseFloat(v.price),
            unit: v.unit.trim(),
            stock_qty: parseFloat(v.stock_qty),
            stock_alert: parseInt(v.stock_alert, 10),
            is_active: v.is_active,
          }))
          const { error: vErr } = await supabase.from('products').insert(variantPayloads)
          if (vErr) throw vErr
        }
        toast.success('Product added successfully')
      }
      setModalOpen(false)
      setVariantsDraft([])
      fetchProducts()
    } catch (error) {
      toast.error('Unable to save product')
      console.error(error)
    }
  }

  async function handleDeactivateProduct(product: Product) {
    if (!product.is_active) {
      toast.info('Product is already inactive.')
      return
    }
    try {
      const { error } = await supabase.from('products').update({ is_active: false }).eq('id', product.id).single()
      if (error) throw error
      toast.success('Product deactivated successfully')
      fetchProducts()
    } catch (error) {
      toast.error('Unable to deactivate product')
      console.error(error)
    }
  }

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products.filter(product => {
      if (product.parent_product_id) return false
      if (statusFilter === 'active' && !product.is_active) return false
      if (statusFilter === 'inactive' && product.is_active) return false
      const matchesSearch =
        !query ||
        product.name.toLowerCase().includes(query) ||
        (product.variety || '').toLowerCase().includes(query) ||
        (product.description || '').toLowerCase().includes(query) ||
        ((product.category as { name?: string })?.name || '').toLowerCase().includes(query)
      const matchesCategory =
        categoryFilter === 'all' ||
        ((product.category as { name?: string })?.name || 'Uncategorized') === categoryFilter
      return matchesSearch && matchesCategory
    })
  }, [products, search, categoryFilter, statusFilter])

  const selectedVariants = useMemo(() => {
    if (!selectedProduct) return []
    return products.filter(product => product.parent_product_id === selectedProduct.id)
  }, [products, selectedProduct])

  const categoryOptions = ['all', ...Array.from(new Set(products.map(product => ((product.category as { name?: string })?.name || 'Uncategorized'))))]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner label="Loading products..." />
      </div>
    )
  }

  const modalTitle = editingProduct
    ? 'Edit Product'
    : form.parent_product_id
    ? 'Add Variant'
    : 'Add Product'

  const parentProductName = form.parent_product_id
    ? products.find(p => p.id === form.parent_product_id)?.name
    : undefined

  return (
    <RoleGuard allowed={['owner']}>
      <div className="space-y-6">
        <PageHeader
          title="Products"
          description="Manage your catalog and inventory items"
          action={
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
              <button onClick={() => openNewProduct()} className="btn-primary inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Product
              </button>
              {selectedProduct && (
                <button
                  onClick={() => openNewProduct(selectedProduct.parent_product_id || selectedProduct.id, selectedProduct.category_id, selectedProduct)}
                  className="btn-secondary inline-flex items-center gap-2 mt-2 sm:mt-0"
                >
                  <Plus className="w-4 h-4" /> Add Variant
                </button>
              )}
            </div>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-4">
            <p className="text-xs text-slate-500">Total parent products</p>
            <p className="text-2xl font-bold text-slate-900">{products.filter(p => !p.parent_product_id).length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500">Active parent products</p>
            <p className="text-2xl font-bold text-emerald-600">{products.filter(p => !p.parent_product_id && p.is_active).length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500">Categories</p>
            <p className="text-2xl font-bold text-brand-600">{categories.length}</p>
          </div>
        </div>

        <div className="card p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 text-slate-400 w-4 h-4" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search products..."
                className="input pl-10 w-full"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="input w-full"
            >
              {categoryOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
              className="input w-full"
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Stock</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">No products found.</td>
                </tr>
              ) : (
                filteredProducts.map(product => {
                  const parentName = product.parent_product_id
                    ? products.find(p => p.id === product.parent_product_id)?.name
                    : null
                  return (
                    <tr key={product.id} className="table-row-hover cursor-pointer" onClick={() => setSelectedProduct(product)}>
                      <td className="px-4 py-4 text-sm font-medium text-slate-900">
                        {product.name}
                        {product.parent_product_id ? (
                          <span className="ml-2 inline-block text-xs rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">Variant</span>
                        ) : products.some(p => p.parent_product_id === product.id) ? (
                          <span className="ml-2 inline-block text-xs rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">Parent</span>
                        ) : null}
                        {parentName && (
                          <div className="mt-1 text-xs text-slate-500">Variant of {parentName}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">{((product.category as { name?: string })?.name) || 'Uncategorized'}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatMoney(product.price, 'KSh')}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{product.stock_qty} {product.unit}</td>
                      <td className="px-4 py-4 text-sm">
                        <span className={product.is_active ? 'inline-flex rounded-full bg-emerald-100 px-2 py-1 text-emerald-700 text-xs font-semibold' : 'inline-flex rounded-full bg-slate-100 px-2 py-1 text-slate-500 text-xs font-semibold'}>
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium space-x-2">
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            const parentId = product.parent_product_id || product.id
                            const parentProd = products.find(p => p.id === parentId)
                            openNewProduct(parentId, product.category_id, parentProd)
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs"
                          title="Add variant"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Variant</span>
                        </button>
                        <button onClick={e => { e.stopPropagation(); openEditProduct(product) }} className="text-slate-600 hover:text-brand-600" title="Edit product"><Edit3 className="inline w-4 h-4" /></button>
                        <button onClick={e => { e.stopPropagation(); handleDeactivateProduct(product) }} className="text-slate-600 hover:text-red-600" title="Deactivate">
                          <Trash2 className="inline w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {selectedProduct && (
          <div className="card mt-6 p-6 border-emerald-100 bg-emerald-50/40">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
              <div>
                <h4 className="text-lg font-semibold text-slate-900">{selectedProduct.name} {products.some(p => p.parent_product_id === selectedProduct.id) && <span className="ml-2 inline-block text-xs rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">Parent</span>}</h4>
                <p className="text-sm text-slate-600">Selected product details and variants.</p>
              </div>
              <button
                onClick={() => openNewProduct(selectedProduct.parent_product_id || selectedProduct.id, selectedProduct.category_id, selectedProduct)}
                className="btn-primary inline-flex items-center gap-2 text-sm"
              >
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
                          <td className="table-cell">{formatMoney(variant.price, 'KSh')}</td>
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

        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title={modalTitle}
          description="Create or update a catalog item."
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end sm:items-center">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:mr-auto">
                {editingProduct && (
                  <button
                    type="button"
                    onClick={addVariantDraft}
                    className="btn-secondary inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add Variant Draft
                  </button>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleSaveProduct} className="btn-primary inline-flex items-center gap-2">
                  <Save className="w-4 h-4" /> {editingProduct ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          }
          size="xl"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {parentProductName && (
              <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Adding variant for</p>
                <p>{parentProductName}</p>
              </div>
            )}
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Product name</span>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="input w-full"
              />
              {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Variety</span>
              <input
                value={form.variety}
                onChange={e => setForm({ ...form, variety: e.target.value })}
                className="input w-full"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Price</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={e => setForm({ ...form, price: e.target.value })}
                className="input w-full"
              />
              {errors.price && <p className="text-xs text-red-600">{errors.price}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Stock quantity</span>
              <input
                value={form.stock_qty}
                onChange={e => setForm({ ...form, stock_qty: e.target.value })}
                className="input w-full"
              />
              {errors.stock_qty && <p className="text-xs text-red-600">{errors.stock_qty}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Unit</span>
              <input
                value={form.unit}
                onChange={e => setForm({ ...form, unit: e.target.value })}
                className="input w-full"
              />
              {errors.unit && <p className="text-xs text-red-600">{errors.unit}</p>}
            </label>
            <div className="sm:col-span-2">
              <h5 className="font-semibold text-slate-900 mb-2">Variants</h5>
              {editingProduct && !editingProduct.parent_product_id && (
                <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Existing variants</p>
                      <p className="text-xs text-slate-500">Variants already attached to this product.</p>
                    </div>
                    <button
                      type="button"
                      onClick={addVariantDraft}
                      className="btn-secondary inline-flex items-center gap-2 text-sm"
                    >
                      <Plus className="w-4 h-4" /> Add Variant Draft
                    </button>
                  </div>
                  {products.filter(p => p.parent_product_id === editingProduct.id).length === 0 ? (
                    <p className="text-sm text-slate-500">No existing variants attached.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-white">
                          <tr>
                            <th className="table-head">Name</th>
                            <th className="table-head">Unit</th>
                            <th className="table-head">Qty</th>
                            <th className="table-head">Price</th>
                            <th className="table-head text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {products.filter(p => p.parent_product_id === editingProduct.id).map(v => (
                            <tr key={v.id} className="table-row-hover">
                              <td className="px-3 py-2 text-sm text-slate-900">{v.name}</td>
                              <td className="px-3 py-2 text-sm text-slate-600">{v.unit}</td>
                              <td className="px-3 py-2 text-sm text-slate-600">{v.stock_qty}</td>
                              <td className="px-3 py-2 text-sm text-slate-600">{formatMoney(v.price, 'KSh')}</td>
                              <td className="px-3 py-2 text-right"><button onClick={() => openEditProduct(v)} className="text-slate-600 hover:text-brand-600"><Edit3 className="inline w-4 h-4" /></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {variantsDraft.length > 0 && (
                <div className="mb-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Variant drafts</p>
                      <p className="text-xs text-slate-500">Each variant is a mini product under the parent.</p>
                    </div>
                    <button type="button" onClick={addVariantDraft} className="btn-secondary inline-flex items-center gap-2 text-sm">
                      <Plus className="w-4 h-4" /> Add another variant
                    </button>
                  </div>
                  <div className="space-y-4">
                    {variantsDraft.map((v, i) => (
                      <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <p className="text-sm font-semibold text-slate-900">Variant {i + 1}</p>
                          <button type="button" onClick={() => removeVariantDraft(i)} className="text-sm text-red-600 hover:text-red-800">Remove</button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="space-y-2">
                            <span className="text-xs text-slate-500">Name</span>
                            <input value={v.name} onChange={e => updateVariantDraft(i, 'name', e.target.value)} className="input w-full" />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs text-slate-500">Variety</span>
                            <input value={v.variety} onChange={e => updateVariantDraft(i, 'variety', e.target.value)} className="input w-full" />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs text-slate-500">Category</span>
                            <select value={v.category_id} onChange={e => updateVariantDraft(i, 'category_id', e.target.value)} className="input w-full">
                              <option value="">Uncategorized</option>
                              {categories.map(category => (
                                <option key={category.id} value={category.id}>{category.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs text-slate-500">Price</span>
                            <input type="number" step="0.01" min="0" value={v.price} onChange={e => updateVariantDraft(i, 'price', e.target.value)} className="input w-full" />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs text-slate-500">Quantity</span>
                            <input value={v.stock_qty} onChange={e => updateVariantDraft(i, 'stock_qty', e.target.value)} className="input w-full" />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs text-slate-500">Unit</span>
                            <input value={v.unit} onChange={e => updateVariantDraft(i, 'unit', e.target.value)} className="input w-full" />
                          </label>
                          <label className="space-y-2 sm:col-span-2">
                            <span className="text-xs text-slate-500">Stock alert</span>
                            <input type="number" min="0" value={v.stock_alert} onChange={e => updateVariantDraft(i, 'stock_alert', e.target.value)} className="input w-full" />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-xs text-slate-500">Each variant is saved with its own price, quantity, and unit as a mini product under the parent.</div>
            </div>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Category</span>
              <select
                value={form.category_id}
                onChange={e => setForm({ ...form, category_id: e.target.value })}
                className="input w-full"
              >
                <option value="">Uncategorized</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Description</span>
              <textarea
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="input h-24 w-full resize-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Variety</span>
              <input
                value={form.variety}
                onChange={e => setForm({ ...form, variety: e.target.value })}
                className="input w-full"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Price</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={e => setForm({ ...form, price: e.target.value })}
                className="input w-full"
              />
              {errors.price && <p className="text-xs text-red-600">{errors.price}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Unit</span>
              <input
                value={form.unit}
                onChange={e => setForm({ ...form, unit: e.target.value })}
                className="input w-full"
              />
              {errors.unit && <p className="text-xs text-red-600">{errors.unit}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Stock quantity</span>
              <input
                type="text"
                placeholder="e.g. 500 ml, 1.5 ltr, 12 pack"
                value={form.stock_qty}
                onChange={e => setForm({ ...form, stock_qty: e.target.value })}
                className="input w-full"
              />
              {errors.stock_qty && <p className="text-xs text-red-600">{errors.stock_qty}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Low stock alert</span>
              <input
                type="number"
                min="0"
                value={form.stock_alert}
                onChange={e => setForm({ ...form, stock_alert: e.target.value })}
                className="input w-full"
              />
              {errors.stock_alert && <p className="text-xs text-red-600">{errors.stock_alert}</p>}
            </label>
            <label className="flex items-center gap-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Mark as active</span>
            </label>
          </div>
        </Modal>
      </div>
    </RoleGuard>
  )
}
