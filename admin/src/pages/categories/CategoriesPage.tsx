import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Edit, Trash2, Tag, RefreshCw } from 'lucide-react'
import { categoryService } from '../../services/categoryService'
import { Category } from '../../types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Modal, ConfirmDialog } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

export const CategoriesPage: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)

  // Form inputs
  const [name, setName] = useState('')
  const [image, setImage] = useState('')
  const [banner, setBanner] = useState('')
  const [description, setDescription] = useState('')
  const [isFeatured, setIsFeatured] = useState(false)

  const fetchCategories = async () => {
    setIsLoading(true)
    try {
      const data = await categoryService.getCategories()
      setCategories(data)
    } catch (err) {
      toast.error('Failed to load categories')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCategories()
  }, [])

  const openAddModal = () => {
    setEditId(null)
    setName('')
    setImage('')
    setBanner('')
    setDescription('')
    setIsFeatured(false)
    setIsModalOpen(true)
  }

  const openEditModal = (cat: Category) => {
    setEditId(cat.id)
    setName(cat.name)
    setImage(cat.image || '')
    setBanner(cat.banner || '')
    setDescription(cat.description || '')
    setIsFeatured(cat.isFeatured)
    setIsModalOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) {
      toast.error('Category Name is mandatory')
      return
    }

    const payload = {
      name,
      description: description || undefined,
      image: image || undefined,
      banner: banner || undefined,
      isFeatured,
    }

    try {
      if (editId) {
        await categoryService.updateCategory(editId, payload)
        toast.success('Category updated successfully!')
      } else {
        await categoryService.createCategory(payload)
        toast.success('Category created successfully!')
      }
      setIsModalOpen(false)
      fetchCategories()
    } catch (err) {
      toast.error('Operation failed')
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await categoryService.deleteCategory(deleteId)
      toast.success('Category deleted successfully')
      fetchCategories()
    } catch (err) {
      toast.error('Failed to delete category')
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Categories Manager</h1>
          <p className="text-sm text-slate-500">Organize your products catalog into logical collections.</p>
        </div>
        <button
          onClick={openAddModal}
          className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
        >
          <Plus className="h-4 w-4" /> Add Category
        </button>
      </div>

      {/* Categories table listing */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4">Category</th>
                <th className="p-4">Description</th>
                <th className="p-4">Products</th>
                <th className="p-4">Featured</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Loading categories...
                  </td>
                </tr>
              ) : categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-400">
                    No categories registered.
                  </td>
                </tr>
              ) : (
                categories.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center overflow-hidden border">
                          {c.image ? (
                            <img src={c.image} alt={c.name} className="h-full w-full object-cover" />
                          ) : (
                            <Tag className="h-4.5 w-4.5 text-slate-400" />
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{c.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">slug: {c.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-slate-500 max-w-xs truncate">{c.description || '-'}</td>
                    <td className="p-4">
                      <Link
                        to={`/products?category=${c.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                      >
                        {c.productCount || 0} products
                      </Link>
                    </td>
                    <td className="p-4">
                      {c.isFeatured ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400">
                          Featured
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
                          Not Featured
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => openEditModal(c)}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-blue-600"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(c.id)}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Category Dialog Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editId ? 'Edit Category' : 'Create New Category'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Category Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Wellness Oils"
              className="input"
            />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of products in this category..."
              className="input h-20"
            />
          </div>

          <div>
            <label className="label">Thumbnail Image URL (Optional)</label>
            <input
              type="text"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://images.unsplash.com/photo-..."
              className="input"
            />
          </div>

          <div>
            <label className="label">Banner Image URL (Optional)</label>
            <input
              type="text"
              value={banner}
              onChange={(e) => setBanner(e.target.value)}
              placeholder="https://images.unsplash.com/photo-..."
              className="input"
            />
          </div>

          <label className="flex items-center gap-2 p-1 cursor-pointer">
            <input
              type="checkbox"
              checked={isFeatured}
              onChange={(e) => setIsFeatured(e.target.checked)}
              className="rounded text-primary-600 focus:ring-primary-500 h-4 w-4"
            />
            <span className="text-xs font-semibold">Mark as Featured Category</span>
          </label>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="btn-outline px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary px-4 py-2 text-xs">
              Save Category
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Category"
        message="Are you sure you want to permanently delete this category? Make sure no products are associated with it."
        isDestructive
      />
    </div>
  )
}
export default CategoriesPage
