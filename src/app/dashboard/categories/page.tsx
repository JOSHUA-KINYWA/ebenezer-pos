'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Modal } from '@/components/Modal'
import { RoleGuard } from '@/components/RoleGuard'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useToast } from '@/context/ToastContext'
import { Category } from '@/types'
import { validateCategoryForm } from '@/lib/validators'
import { Plus, Edit3, Trash2, Save, X, PowerOff } from 'lucide-react'

interface CategoryForm {
  name: string
  description: string
}

const initialForm: CategoryForm = {
  name: '',
  description: '',
}

export default function CategoriesPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [form, setForm] = useState<CategoryForm>(initialForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null)
  const toast = useToast()
  const supabase = createClient()

  useEffect(() => {
    const session = getSession()
    if (!session) {
      router.push('/login')
      return
    }
    fetchCategories()
  }, [])

  async function fetchCategories() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('categories').select('*').order('name')
      if (error) throw error
      setCategories(data || [])
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load categories'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  function openNewCategory() {
    setEditingCategory(null)
    setForm(initialForm)
    setErrors({})
    setModalOpen(true)
  }

  function openEditCategory(category: Category) {
    setEditingCategory(category)
    setForm({
      name: category.name,
      description: category.description || '',
    })
    setErrors({})
    setModalOpen(true)
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

  async function handleSaveCategory() {

    const trimmedName = form.name.trim()
    const duplicate = categories.find(c => c.name.toLowerCase() === trimmedName.toLowerCase() && c.id !== editingCategory?.id)
    if (duplicate) {
      toast.error(`❌ Category "${trimmedName}" already exists`)
      return
    }

    const payload: Record<string, unknown> = {
      name: trimmedName,
    }
    const description = form.description.trim()
    if (description) {
      payload.description = description
    }

    try {
      if (editingCategory) {
        const { error } = await supabase.from('categories').update(payload).eq('id', editingCategory.id)
        if (error) throw error
        toast.success('Category updated successfully')
      } else {
        const { error } = await supabase.from('categories').insert([payload])
        if (error) throw error
        toast.success('Category created successfully')
      }
      setModalOpen(false)
      fetchCategories()
    } catch (error) {
      const message = getSupabaseErrorMessage(error)
      toast.error(`❌ ${message}`)
      console.error(error)
    }
  }

  async function handleToggleActive(category: Category) {
    try {
      const { error } = await supabase.from('categories').update({ is_active: !category.is_active }).eq('id', category.id)
      if (error) throw error
      toast.success(`${category.is_active ? 'Deactivated' : 'Activated'} category`)
      fetchCategories()
    } catch (error) {
      const message = getSupabaseErrorMessage(error)
      toast.error(`❌ ${message}`)
      console.error(error)
    }
  }

  async function handleDeleteCategory(category: Category) {
    try {
      const { error } = await supabase.from('categories').delete().eq('id', category.id)
      if (error) throw error
      toast.success('Category deleted successfully')
      setDeleteConfirm(null)
      fetchCategories()
    } catch (error) {
      const message = getSupabaseErrorMessage(error)
      toast.error(`❌ ${message}`)
      console.error(error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner label="Loading categories..." />
      </div>
    )
  }

  return (
    <RoleGuard allowed={['owner']}>
      <div className="space-y-6">
        <PageHeader
          title="Categories"
          description="Manage product categories used in your catalog"
          action={
            <button onClick={openNewCategory} className="btn-primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Category
            </button>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-4">
            <p className="text-xs text-slate-500">Total categories</p>
            <p className="text-2xl font-bold text-slate-900">{categories.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500">Active categories</p>
            <p className="text-2xl font-bold text-emerald-600">{categories.filter(c => c.is_active).length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-slate-500">Inactive categories</p>
            <p className="text-2xl font-bold text-slate-900">{categories.filter(c => !c.is_active).length}</p>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map(category => (
                <tr key={category.id}>
                  <td className="px-4 py-4 text-sm font-medium text-slate-900">{category.name}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{category.description || '—'}</td>
                  <td className="px-4 py-4 text-sm">
                    <span className={category.is_active ? 'inline-flex rounded-full bg-emerald-100 px-2 py-1 text-emerald-700 text-xs font-semibold' : 'inline-flex rounded-full bg-slate-100 px-2 py-1 text-slate-500 text-xs font-semibold'}>
                      {category.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEditCategory(category)} className="text-slate-600 hover:text-brand-600" title="Edit category">
                        <Edit3 className="inline w-4 h-4" />
                      </button>
                      <button onClick={() => handleToggleActive(category)} className={category.is_active ? 'text-slate-400 hover:text-amber-600' : 'text-emerald-600 hover:text-emerald-700'} title={category.is_active ? 'Deactivate' : 'Activate'}>
                        <PowerOff className="inline w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteConfirm(category)} className="text-slate-600 hover:text-red-600" title="Delete category">
                        <Trash2 className="inline w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">No categories available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editingCategory ? 'Edit Category' : 'Add Category'}
          description="Create or update a category used by products."
          footer={
            <div className="flex justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
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
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="input w-full"
              />
              {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Description</span>
              <textarea
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="input h-28 w-full resize-none"
              />
            </label>
          </div>
        </Modal>

        {deleteConfirm && (
          <Modal
            isOpen={!!deleteConfirm}
            onClose={() => setDeleteConfirm(null)}
            title="Delete Category"
            description={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
            footer={
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">Cancel</button>
                <button onClick={() => handleDeleteCategory(deleteConfirm)} className="btn-danger inline-flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            }
            size="sm"
          >
            <p className="text-sm text-slate-600">
              Products linked to this category will have their category cleared. This is permanent.
            </p>
          </Modal>
        )}
      </div>
    </RoleGuard>
  )
}
