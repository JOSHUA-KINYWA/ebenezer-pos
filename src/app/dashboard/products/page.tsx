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
import { Product, Category, PricingTier } from '@/types'
import { validateProductForm } from '@/lib/validators'
import { formatMoney } from '@/lib/format'
import { Search, Plus, Edit3, Trash2, Save, PowerOff } from 'lucide-react'

interface ProductWithMetrics extends Product {
  soldUnits: number
  soldRevenue: number
  soldCost: number
  profit: number
  initial_stock: number
  totalExpectedProfit: number
  remainingPotentialProfit: number
}

interface ProductForm {
  name: string
  variety: string
  description: string
  category_id: string
  parent_product_id: string
  price: string
  cost_price: string
  unit: string
  initial_stock: string
  stock_qty: string
  stock_alert: string
  is_active: boolean
  product_type: 'standalone' | 'parent'
  group_size: string
  group_price: string
  pricing_tiers: string
}

const initialForm: ProductForm = {
  name: '',
  variety: '',
  description: '',
  category_id: '',
  parent_product_id: '',
  price: '0.00',
  cost_price: '0.00',
  unit: 'piece',
  initial_stock: '0',
  stock_qty: '0',
  stock_alert: '10',
  is_active: true,
  product_type: 'standalone',
  group_size: '1',
  group_price: '',
  pricing_tiers: '',
}

export default function ProductsPage() {
  const router = useRouter()
  const [products, setProducts] = useState<ProductWithMetrics[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<ProductWithMetrics | null>(null)
  const [form, setForm] = useState<ProductForm>(initialForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [variantsDraft, setVariantsDraft] = useState<ProductForm[]>([])
  const [pricingTiersDraft, setPricingTiersDraft] = useState<{ min_qty: string; price: string }[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [deactivateConfirm, setDeactivateConfirm] = useState<Product | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null)
  const toast = useToast()
  const supabase = createClient()

  function parsePricingTiersSafe(tiers: PricingTier[] | string | null | undefined): PricingTier[] {
    if (!tiers) return []
    if (typeof tiers === 'string') {
      try {
        tiers = JSON.parse(tiers)
      } catch {
        return []
      }
    }
    return Array.isArray(tiers) ? tiers.filter(t => t && t.min_qty > 0 && t.price > 0) : []
  }

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
      const { data, error } = await supabase
        .from('products')
        .select('*, category:categories(name)')
        .eq('is_active', true)
        .order('name')

      if (error) throw error

      const productsData = (data || []) as Product[]
      const activeProductIds = productsData.map(p => p.id)

      const { data: saleIdsData, error: saleIdsError } = await supabase
        .from('sales')
        .select('id')
        .eq('is_voided', false)

      if (saleIdsError) throw saleIdsError

      const saleIds = (saleIdsData || []).map(s => s.id)
      const { data: saleItemsData, error: saleItemsError } = activeProductIds.length > 0 && saleIds.length > 0
        ? await supabase
            .from('sale_items')
            .select('product_id, quantity, subtotal')
            .in('product_id', activeProductIds)
            .in('sale_id', saleIds)
        : { data: [], error: null }

      if (saleItemsError) throw saleItemsError

      const salesByProduct = new Map<string, { soldUnits: number; soldRevenue: number }>()
      ;(saleItemsData || []).forEach(item => {
        if (!item.product_id) return
        const existing = salesByProduct.get(item.product_id) || { soldUnits: 0, soldRevenue: 0 }
        const quantity = Number(item.quantity || 0)
        const subtotal = Number(item.subtotal || 0)
        existing.soldUnits += quantity
        existing.soldRevenue += subtotal
        salesByProduct.set(item.product_id, existing)
      })

      const productsWithMetrics: ProductWithMetrics[] = productsData.map(product => {
        const variants = productsData.filter(p => p.parent_product_id === product.id)
        const isParent = variants.length > 0
        const costPerUnit = Number(product.cost_price) || 0
        const margin = Number(product.price) - costPerUnit

        const aggregateSoldUnits = isParent
          ? variants.reduce((sum, v) => sum + Number(salesByProduct.get(v.id)?.soldUnits || 0), 0)
          : Number(salesByProduct.get(product.id)?.soldUnits || 0)

        const aggregateSoldRevenue = isParent
          ? variants.reduce((sum, v) => sum + Number(salesByProduct.get(v.id)?.soldRevenue || 0), 0)
          : Number(salesByProduct.get(product.id)?.soldRevenue || 0)

        const aggregateSoldCost = aggregateSoldUnits * costPerUnit
        const aggregateProfit = aggregateSoldRevenue - aggregateSoldCost
        const aggregateStock = isParent ? variants.reduce((sum, v) => sum + Number(v.stock_qty || 0), 0) : Number(product.stock_qty || 0)
        const aggregateInitialStock = isParent ? variants.reduce((sum, v) => sum + Number(v.initial_stock || 0), 0) : Number(product.initial_stock || 0)

        const totalExpectedProfit = aggregateInitialStock * margin
        const remainingPotentialProfit = aggregateStock * margin

        return {
          ...product,
          soldUnits: aggregateSoldUnits,
          soldRevenue: aggregateSoldRevenue,
          soldCost: aggregateSoldCost,
          profit: aggregateProfit,
          initial_stock: aggregateInitialStock,
          totalExpectedProfit,
          remainingPotentialProfit,
        }
      })

      setProducts(productsWithMetrics)
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
      product_type: 'standalone',
      group_size: '1',
      group_price: '',
      pricing_tiers: '',
    })
    setErrors({})
    setEditingProduct(null)
    setVariantsDraft([])
    setPricingTiersDraft([])
  }

  function openNewProduct(parentId?: string, parentCategoryId?: string, parent?: Product) {
    setForm({
      ...initialForm,
      category_id: (parentCategoryId || categories[0]?.id) ?? '',
      parent_product_id: parentId || '',
      price: parent?.price?.toString() || initialForm.price,
      cost_price: parent?.cost_price?.toString() || initialForm.cost_price,
      unit: parent?.unit || initialForm.unit,
      initial_stock: '0',
      stock_alert: parent?.stock_alert?.toString() || initialForm.stock_alert,
      name: '',
      product_type: 'standalone',
      group_size: (parent?.group_size || 1).toString(),
      group_price: parent?.group_price !== undefined && parent?.group_price !== null ? parent.group_price.toString() : '',
      pricing_tiers: '',
    })
    setErrors({})
    setVariantsDraft([])
    setPricingTiersDraft(parent?.pricing_tiers ? JSON.parse(typeof parent.pricing_tiers === 'string' ? parent.pricing_tiers : JSON.stringify(parent.pricing_tiers)).map((t: any) => ({ min_qty: String(t.min_qty || 1), price: String(t.price || 0) })) : [])
    setEditingProduct(null)
    setModalOpen(true)
  }

  function openEditProduct(product: Product) {
    setEditingProduct(product)
    const isVariant = !!product.parent_product_id
    const hasChildren = products.some(p => p.parent_product_id === product.id)
    setForm({
      name: product.name || '',
      variety: product.variety || '',
      description: product.description || '',
      category_id: product.category_id || categories[0]?.id || '',
      parent_product_id: product.parent_product_id || '',
      price: product.price?.toString() || '0.00',
      cost_price: product.cost_price?.toString() || '0.00',
      unit: product.unit || 'piece',
      initial_stock: product.initial_stock?.toString() || '0',
      stock_qty: product.stock_qty?.toString() || '0',
      stock_alert: product.stock_alert?.toString() || '10',
      is_active: product.is_active,
      product_type: isVariant ? 'standalone' : (hasChildren ? 'parent' : 'standalone'),
      group_size: (product.group_size || 1).toString(),
      group_price: product.group_price !== undefined && product.group_price !== null ? product.group_price.toString() : '',
      pricing_tiers: '',
    })
    setErrors({})
    setVariantsDraft([])
    let tiersFromProduct: { min_qty: string; price: string }[] = []
    if (product.pricing_tiers) {
      try {
        const parsed = typeof product.pricing_tiers === 'string' ? JSON.parse(product.pricing_tiers) : product.pricing_tiers
        tiersFromProduct = (Array.isArray(parsed) ? parsed : []).map((t: any) => ({ min_qty: String(t.min_qty || 1), price: String(t.price || 0) }))
      } catch {
        tiersFromProduct = []
      }
    }
    setPricingTiersDraft(tiersFromProduct)
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
        cost_price: form.cost_price,
        unit: form.unit,
        initial_stock: form.initial_stock,
        stock_qty: form.initial_stock,
        stock_alert: form.stock_alert,
        is_active: true,
        product_type: 'standalone',
        group_size: form.group_size,
        group_price: form.group_price,
        pricing_tiers: form.pricing_tiers,
      },
    ])
  }

  function updateVariantDraft(index: number, field: keyof ProductForm, value: string | boolean) {
    setVariantsDraft(prev => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))
  }

  function removeVariantDraft(index: number) {
    setVariantsDraft(prev => prev.filter((_, i) => i !== index))
  }

  function getSupabaseErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message?: unknown }).message)
    }
    if (error instanceof Error) {
      return error.message
    }
    return 'Unexpected error'
  }

  async function handleSaveProduct() {
    const validation = validateProductForm(form)
    if (!validation.isValid) {
      const nextErrors = Object.fromEntries(validation.errors.map(error => [error.field, error.message]))
      setErrors(nextErrors)
      return
    }

    const initialStock = parseFloat(form.initial_stock || '0')
    const currentStock = parseFloat(form.stock_qty || '0')
    const groupSize = parseInt(form.group_size, 10) || 1
    const groupPriceRaw = form.group_price && form.group_price.trim() !== '' ? parseFloat(form.group_price) : null
    const pricingTiersRaw = pricingTiersDraft.length > 0
      ? JSON.stringify(pricingTiersDraft.map(t => ({ min_qty: parseInt(t.min_qty, 10) || 1, price: parseFloat(t.price) || 0 })))
      : null
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      variety: form.variety.trim() || null,
      description: form.description.trim() || null,
      price: parseFloat(form.price),
      cost_price: parseFloat(form.cost_price),
      unit: form.unit.trim(),
      stock_qty: editingProduct ? currentStock : initialStock,
      initial_stock: initialStock,
      stock_alert: parseInt(form.stock_alert, 10),
      is_active: form.is_active,
      group_size: groupSize,
      group_price: groupPriceRaw,
      pricing_tiers: pricingTiersRaw,
    }
    if (form.category_id) {
      payload.category_id = form.category_id
    }
    if (form.parent_product_id) {
      payload.parent_product_id = form.parent_product_id
    }

    try {
      if (editingProduct) {
        const { error } = await supabase.from('products').update(payload).eq('id', editingProduct.id)
        if (error) throw error
        if (variantsDraft.length > 0) {
          const variantParentId = form.parent_product_id || editingProduct.id
          const variantPayloads = variantsDraft.map(v => {
            const vInitialStock = parseFloat(v.initial_stock || '0')
            const vGroupSize = parseInt(v.group_size, 10) || 1
            const vGroupPriceRaw = v.group_price && v.group_price.trim() !== '' ? parseFloat(v.group_price) : null
            const vPayload: Record<string, unknown> = {
              name: v.name.trim(),
              variety: v.variety.trim() || null,
              description: v.description.trim() || null,
              price: parseFloat(v.price) || 0,
              cost_price: parseFloat(v.cost_price) || 0,
              unit: v.unit.trim(),
              stock_qty: vInitialStock,
              initial_stock: vInitialStock,
              stock_alert: parseInt(v.stock_alert, 10) || 0,
              is_active: v.is_active,
              parent_product_id: variantParentId,
              group_size: vGroupSize,
              group_price: vGroupPriceRaw,
              pricing_tiers: null,
            }
            if (v.category_id) {
              vPayload.category_id = v.category_id
            }
            return vPayload
          })
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
          const variantPayloads = variantsDraft.map(v => {
            const vInitialStock = parseFloat(v.initial_stock || '0')
            const vGroupSize = parseInt(v.group_size, 10) || 1
            const vGroupPriceRaw = v.group_price && v.group_price.trim() !== '' ? parseFloat(v.group_price) : null
            const vPayload: Record<string, unknown> = {
              name: v.name.trim(),
              variety: v.variety.trim() || null,
              description: v.description.trim() || null,
              price: parseFloat(v.price) || 0,
              cost_price: parseFloat(v.cost_price) || 0,
              unit: v.unit.trim(),
              stock_qty: vInitialStock,
              initial_stock: vInitialStock,
              stock_alert: parseInt(v.stock_alert, 10) || 0,
              is_active: v.is_active,
              parent_product_id: parentId,
              group_size: vGroupSize,
              group_price: vGroupPriceRaw,
              pricing_tiers: null,
            }
            if (v.category_id) {
              vPayload.category_id = v.category_id
            }
            return vPayload
          })
          const { error: vErr } = await supabase.from('products').insert(variantPayloads)
          if (vErr) throw vErr
        }
        toast.success('Product added successfully')
      }
      setModalOpen(false)
      setVariantsDraft([])
      setPricingTiersDraft([])
      fetchProducts()
    } catch (error) {
      const message = getSupabaseErrorMessage(error)
      toast.error(`❌ ${message}`)
      console.error(error)
    }
  }

  async function handleDeactivateProduct(product: Product) {
    if (!product.is_active) {
      toast.info('Product is already inactive.')
      return
    }
    setDeactivateConfirm(product)
  }

  async function confirmDeactivateProduct() {
    if (!deactivateConfirm) return
    try {
      const { error } = await supabase.from('products').update({ is_active: false }).eq('id', deactivateConfirm.id)
      if (error) throw error
      toast.success('Product deactivated successfully')
      setDeactivateConfirm(null)
      fetchProducts()
    } catch (error) {
      const message = getSupabaseErrorMessage(error)
      toast.error(`❌ ${message}`)
      console.error(error)
    }
  }

  async function handleDeleteProduct(product: Product) {
    if (product.is_active) {
      toast.info('Deactivate the product first before deleting it.')
      return
    }
    setDeleteConfirm(product)
  }

  async function confirmDeleteProduct() {
    if (!deleteConfirm) return
    try {
      const { error } = await supabase.from('products').delete().eq('id', deleteConfirm.id)
      if (error) throw error
      toast.success('Product deleted successfully')
      setSelectedProduct(current => (current?.id === deleteConfirm.id ? null : current))
      setDeleteConfirm(null)
      fetchProducts()
    } catch (error) {
      const message = getSupabaseErrorMessage(error)
      toast.error(`❌ ${message}`)
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
    : form.product_type === 'parent'
    ? 'Add Parent Product'
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
                 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Group</th>
                 <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Stock</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">No products found.</td>
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
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {product.group_price && product.group_price > 0 && (product.group_size || 1) > 1
                          ? `${formatMoney(product.group_price / (product.group_size || 1), 'KSh')}/unit (${formatMoney(product.group_price, 'KSh')} / pack of ${product.group_size})`
                          : formatMoney(product.price, 'KSh')}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {product.group_size && product.group_size > 1
                          ? `${product.group_size} ${product.unit}/pack`
                          : '-'}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {product.parent_product_id
                          ? `${product.stock_qty} ${product.unit}`
                          : products.some(p => p.parent_product_id === product.id)
                            ? products.filter(p => p.parent_product_id === product.id).reduce((sum, p) => sum + Number(p.stock_qty || 0), 0).toLocaleString()
                            : `${product.stock_qty} ${product.unit}`}
                      </td>
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
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (product.is_active) {
                              setDeactivateConfirm(product)
                            } else {
                              setDeleteConfirm(product)
                            }
                          }}
                          className={product.is_active ? 'text-slate-600 hover:text-red-600' : 'text-red-600 hover:text-red-700'}
                          title={product.is_active ? 'Deactivate' : 'Delete'}
                        >
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
                <p className="text-xs uppercase tracking-wider text-slate-500">Selling price</p>
                <p className="text-sm text-slate-900">
                  {selectedProduct.group_price && selectedProduct.group_price > 0 && (selectedProduct.group_size || 1) > 1
                    ? `${formatMoney(selectedProduct.group_price / (selectedProduct.group_size || 1), 'KSh')} per unit (${formatMoney(selectedProduct.group_price, 'KSh')} per pack of ${selectedProduct.group_size})`
                    : formatMoney(selectedProduct.price, 'KSh')}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Buying price</p>
                <p className="text-sm text-slate-900">{formatMoney(selectedProduct.cost_price ?? 0, 'KSh')}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Margin</p>
                <p className="text-sm text-slate-900">
                  {selectedProduct.group_price && selectedProduct.group_price > 0 && (selectedProduct.group_size || 1) > 1
                    ? formatMoney(selectedProduct.group_price / (selectedProduct.group_size || 1) - (selectedProduct.cost_price ?? 0), 'KSh')
                    : formatMoney((selectedProduct.price || 0) - (selectedProduct.cost_price ?? 0), 'KSh')}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Group size</p>
                <p className="text-sm text-slate-900">{selectedProduct.group_size || 1} {selectedProduct.group_size && selectedProduct.group_size > 1 ? `(${selectedProduct.unit}s per pack)` : ''}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Quantity</p>
                <p className="text-sm text-slate-900">
                  {selectedProduct.parent_product_id
                    ? `${selectedProduct.stock_qty} ${selectedProduct.unit}`
                    : products.some(p => p.parent_product_id === selectedProduct.id)
                      ? `${products.filter(p => p.parent_product_id === selectedProduct.id).reduce((sum, p) => sum + Number(p.stock_qty || 0), 0).toLocaleString()} (all variants)`
                      : `${selectedProduct.stock_qty} ${selectedProduct.unit}`}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Initial stock</p>
                <p className="text-sm text-slate-900">{(selectedProduct.initial_stock || 0).toLocaleString()} {selectedProduct.unit}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Low stock alert</p>
                <p className="text-sm text-slate-900">{selectedProduct.stock_alert} {selectedProduct.unit}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Profit so far</p>
                <p className={`text-sm font-semibold ${(selectedProduct.profit || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatMoney(selectedProduct.profit || 0, 'KSh')}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Expected profit</p>
                <p className="text-sm text-slate-900">{formatMoney(selectedProduct.totalExpectedProfit || 0, 'KSh')}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500">Remaining profit</p>
                <p className="text-sm text-amber-600">{formatMoney(selectedProduct.remainingPotentialProfit || 0, 'KSh')}</p>
              </div>
              {selectedProduct.pricing_tiers && (
                <div className="space-y-2 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Group Pricing Tiers</p>
                  <div className="flex flex-wrap gap-2">
                    {parsePricingTiersSafe(selectedProduct.pricing_tiers).map((tier, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 text-xs text-purple-700">
                        {tier.min_qty} @ {formatMoney(tier.price, 'KSh')}
                      </span>
                    ))}
                  </div>
                 </div>
              )}
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
                        <th className="table-head">Initial</th>
                        <th className="table-head">Price</th>
                        <th className="table-head">Cost</th>
                        <th className="table-head">Profit</th>
                        <th className="table-head text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedVariants.map(variant => {
                        const margin = (variant.price || 0) - (variant.cost_price ?? 0)
                        const expectedProfit = (variant.initial_stock || 0) * margin
                        const remainingProfit = (variant.stock_qty || 0) * margin
                        return (
                          <tr key={variant.id} className="table-row-hover">
                            <td className="table-cell font-medium">{variant.name}</td>
                            <td className="table-cell">{variant.unit}</td>
                            <td className="table-cell">{variant.stock_qty}</td>
                            <td className="table-cell">{(variant.initial_stock || 0).toLocaleString()}</td>
                            <td className="table-cell">{formatMoney(variant.price, 'KSh')}</td>
                            <td className="table-cell">{formatMoney(variant.cost_price ?? 0, 'KSh')}</td>
                            <td className="table-cell">
                              <span className={margin >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                                {formatMoney(expectedProfit, 'KSh')}
                              </span>
                              <span className="text-slate-400 text-xs"> (rem: {formatMoney(remainingProfit, 'KSh')})</span>
                            </td>
                            <td className="table-cell text-right">
                              <button onClick={() => openEditProduct(variant)} className="text-slate-600 hover:text-brand-600"><Edit3 className="inline w-4 h-4" /></button>
                            </td>
                          </tr>
                        )
                      })}
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

            {!editingProduct && !parentProductName && (
              <div className="sm:col-span-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-700">Product type</span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, product_type: 'standalone' })}
                      className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-medium transition ${
                        form.product_type === 'standalone'
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      Standalone product
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, product_type: 'parent' })}
                      className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-medium transition ${
                        form.product_type === 'parent'
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      Parent product (with variants)
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    {form.product_type === 'parent'
                      ? 'Parent products group variants together in the POS (e.g., Rice → Bismart, Pishori).'
                      : 'Sold individually without variants (e.g., a loaf of bread).'}
                  </p>
                </label>
              </div>
            )}

            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Product name</span>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="input w-full"
                placeholder={form.product_type === 'parent' ? 'e.g., Rice' : 'e.g., White Bread'}
              />
              {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Variety</span>
              <input
                value={form.variety}
                onChange={e => setForm({ ...form, variety: e.target.value })}
                className="input w-full"
                placeholder="e.g., 1kg, 500ml, large"
              />
            </label>

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
                className="input h-20 w-full resize-none"
                placeholder="Short description for this product"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Buying price</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.cost_price}
                onChange={e => setForm({ ...form, cost_price: e.target.value })}
                className="input w-full"
              />
              {errors.cost_price && <p className="text-xs text-red-600">{errors.cost_price}</p>}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Selling price</span>
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
                placeholder="piece, kg, litre, pack..."
              />
              {errors.unit && <p className="text-xs text-red-600">{errors.unit}</p>}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Stock</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.initial_stock}
                onChange={e => setForm({ ...form, initial_stock: e.target.value })}
                className="input w-full"
                placeholder="Starting stock quantity"
              />
              <p className="text-xs text-slate-400">This becomes the initial stock for profit projections</p>
              {errors.initial_stock && <p className="text-xs text-red-600">{errors.initial_stock}</p>}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Current Stock</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.stock_qty}
                onChange={e => setForm({ ...form, stock_qty: e.target.value })}
                className="input w-full"
                placeholder="Current stock quantity"
              />
              <p className="text-xs text-slate-400">Current inventory level</p>
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

            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Group / Bundle Pricing</span>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <input
                    type="number"
                    min="1"
                    value={form.group_size}
                    onChange={e => setForm({ ...form, group_size: e.target.value })}
                    className="input w-full"
                    placeholder="Items per pack"
                  />
                  <p className="text-xs text-slate-400">
                    {form.group_size && parseInt(form.group_size, 10) > 1
                      ? `${parseInt(form.group_size, 10)} items sold together as a pack`
                      : 'Sell individually (each item sold separately)'}
                  </p>
                  {errors.group_size && <p className="text-xs text-red-600">{errors.group_size}</p>}
                </div>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.group_price}
                    onChange={e => setForm({ ...form, group_price: e.target.value })}
                    className="input w-full"
                    placeholder="Price per pack (optional)"
                  />
                  <p className="text-xs text-slate-400">
                    {form.group_price && form.group_price.trim() !== '' && parseInt(form.group_size, 10) > 1
                      ? `Per unit: ${formatMoney(parseFloat(form.group_price) / parseInt(form.group_size, 10), 'KSh')}`
                      : 'If blank, uses selling price per unit'}
                  </p>
                  {errors.group_price && <p className="text-xs text-red-600">{errors.group_price}</p>}
                </div>
              </div>
            </label>

            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Group Pricing Tiers</span>
              <div className="space-y-2">
                <p className="text-xs text-slate-400">
                  Offer different prices for different quantities sold together (e.g., 1 @ KSh 5, 2 @ KSh 10).
                  On the sell page, these appear as quick-select buttons.
                </p>
                {pricingTiersDraft.map((tier, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="text-xs text-slate-500">Min Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={tier.min_qty}
                        onChange={e => setPricingTiersDraft(prev => prev.map((t, i) => i === idx ? { ...t, min_qty: e.target.value } : t))}
                        className="input w-full text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-slate-500">Total Price</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={tier.price}
                        onChange={e => setPricingTiersDraft(prev => prev.map((t, i) => i === idx ? { ...t, price: e.target.value } : t))}
                        className="input w-full text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPricingTiersDraft(prev => prev.filter((_, i) => i !== idx))}
                      className="pb-2 text-red-600 hover:text-red-800 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPricingTiersDraft(prev => [...prev, { min_qty: '2', price: '' }])}
                  className="btn-secondary inline-flex items-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" /> Add Tier
                </button>
              </div>
            </label>

            {(form.product_type === 'parent' || (editingProduct && !editingProduct.parent_product_id)) && (
              <div className="sm:col-span-2">
                <h5 className="font-semibold text-slate-900 mb-2">Variants</h5>
                <p className="text-xs text-slate-500 mb-3">
                  Add variants like sizes, brands, or types under this parent product.
                </p>

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
                              <span className="text-xs text-slate-500">Buying price</span>
                              <input type="number" step="0.01" min="0" value={v.cost_price} onChange={e => updateVariantDraft(i, 'cost_price', e.target.value)} className="input w-full" />
                            </label>
                            <label className="space-y-2">
                              <span className="text-xs text-slate-500">Selling price</span>
                              <input type="number" step="0.01" min="0" value={v.price} onChange={e => updateVariantDraft(i, 'price', e.target.value)} className="input w-full" />
                             </label>
                             <label className="space-y-2">
                               <span className="text-xs text-slate-500">Initial stock</span>
                               <input type="number" min="0" step="0.1" value={v.initial_stock} onChange={e => updateVariantDraft(i, 'initial_stock', e.target.value)} className="input w-full" />
                             </label>
                             <label className="space-y-2">
                               <span className="text-xs text-slate-500">Unit</span>
                              <input value={v.unit} onChange={e => updateVariantDraft(i, 'unit', e.target.value)} className="input w-full" />
                            </label>
                            <label className="space-y-2">
                                <span className="text-xs text-slate-500">Stock alert</span>
                               <input type="number" min="0" value={v.stock_alert} onChange={e => updateVariantDraft(i, 'stock_alert', e.target.value)} className="input w-full" />
                             </label>
                             <label className="space-y-2">
                               <span className="text-xs text-slate-500">Group size</span>
                               <input type="number" min="1" value={v.group_size} onChange={e => updateVariantDraft(i, 'group_size', e.target.value)} className="input w-full" />
                             </label>
                             <label className="space-y-2">
                               <span className="text-xs text-slate-500">Group price (pack)</span>
                               <input type="number" step="0.01" min="0" value={v.group_price} onChange={e => updateVariantDraft(i, 'group_price', e.target.value)} className="input w-full" placeholder="Optional" />
                             </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {form.product_type === 'parent' && !editingProduct && variantsDraft.length === 0 && (
                  <button
                    type="button"
                    onClick={addVariantDraft}
                    className="btn-secondary inline-flex items-center gap-2 text-sm"
                  >
                    <Plus className="w-4 h-4" /> Add Variant
                  </button>
                )}
              </div>
            )}

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

        {deactivateConfirm && (
          <Modal
            isOpen={!!deactivateConfirm}
            onClose={() => setDeactivateConfirm(null)}
            title="Deactivate Product"
            description={`Are you sure you want to deactivate "${deactivateConfirm.name}"?`}
            footer={
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeactivateConfirm(null)} className="btn-secondary">Cancel</button>
                <button onClick={confirmDeactivateProduct} className="btn-danger inline-flex items-center gap-2">
                  <PowerOff className="w-4 h-4" /> Deactivate
                </button>
              </div>
            }
            size="sm"
          >
            <p className="text-sm text-slate-600">This product will no longer be available for sale. You can reactivate it later.</p>
          </Modal>
        )}

        {deleteConfirm && (
          <Modal
            isOpen={!!deleteConfirm}
            onClose={() => setDeleteConfirm(null)}
            title="Delete Product"
            description={`Are you sure you want to delete "${deleteConfirm.name}"?`}
            footer={
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">Cancel</button>
                <button onClick={confirmDeleteProduct} className="btn-danger inline-flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            }
            size="sm"
          >
            <p className="text-sm text-slate-600">This action cannot be undone. The product and any attached variants will be permanently removed.</p>
          </Modal>
        )}
      </div>
    </RoleGuard>
  )
}
