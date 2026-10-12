import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Plus, Edit, Trash2, Calendar, RefreshCw } from 'lucide-react'
import { blogService } from '../../services/blogService'
import { Blog, BlogStatus } from '../../types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatDate } from '@meruveda/shared'
import toast from 'react-hot-toast'

export const JournalPage: React.FC = () => {
  const navigate = useNavigate()
  const [blogs, setBlogs] = useState<Blog[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchBlogs = async () => {
    setIsLoading(true)
    try {
      const data = await blogService.getBlogs()
      setBlogs(data)
    } catch (err) {
      toast.error('Failed to load journal posts')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchBlogs()
  }, [])

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this journal post?')) return
    try {
      await blogService.deleteBlog(id)
      toast.success('Journal post deleted')
      fetchBlogs()
    } catch (err) {
      toast.error('Failed to delete journal post')
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Journal Articles</h1>
          <p className="text-sm text-slate-500">Create and manage published journal articles.</p>
        </div>
        <Link
          to="/journal/add"
          className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
        >
          <Plus className="h-4 w-4" /> Add Article
        </Link>
      </div>

      {/* Blogs Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4">Article</th>
                <th className="p-4">Author</th>
                <th className="p-4">Tags</th>
                <th className="p-4">Publish Date</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Loading articles...
                  </td>
                </tr>
              ) : blogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-400">
                    No blog posts registered yet.
                  </td>
                </tr>
              ) : (
                blogs.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={b.featuredImage || 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=100&h=100&fit=crop'}
                          alt={b.title}
                          className="h-10 w-16 rounded object-cover border"
                        />
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white line-clamp-1">
                            {b.title}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">/{b.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-slate-655 dark:text-slate-350">{b.authorName}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {b.tags?.map((tag) => (
                          <span
                            key={tag}
                            style={{ backgroundColor: '#F5F0E8', color: '#1a1a1a', border: '1px solid #D6CCBA' }}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-xs text-slate-500">
                      {b.publishedAt ? formatDate(b.publishedAt) : '—'}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={b.status === 'published' ? 'active' : 'inactive'} />
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Link
                          to={`/journal/${b.id}/edit`}
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-blue-600"
                        >
                          <Edit className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => handleDelete(b.id)}
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
    </div>
  )
}
export default JournalPage
