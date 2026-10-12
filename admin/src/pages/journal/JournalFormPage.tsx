import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, UploadCloud, X, Image as ImageIcon } from 'lucide-react'
import { blogService } from '../../services/blogService'
import { mediaService } from '../../services/mediaService'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import { RichTextEditor } from '../../components/RichTextEditor'
import { MediaLibrarySelectModal } from '../../components/ui/MediaLibrarySelectModal'

export const JournalFormPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { admin } = useAuth()
  const isEditMode = !!id

  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  // Form states
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [content, setContent] = useState('')
  const [featuredImage, setFeaturedImage] = useState('')
  const [tagsInput, setTagsInput] = useState('')

  // Image upload state
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false)

  useEffect(() => {
    const fetchBlogDetail = async () => {
      if (!id) return
      setIsLoading(true)
      try {
        const item = await blogService.getBlogById(id)
        setTitle(item.title)
        setExcerpt(item.excerpt || '')
        setContent(item.content)
        setFeaturedImage(item.featuredImage || '')
        if (item.featuredImage) setImagePreview(item.featuredImage)
        setTagsInput(item.tags ? item.tags.join(', ') : '')
      } catch (err) {
        toast.error('Journal post not found')
        navigate('/journal')
      } finally {
        setIsLoading(false)
      }
    }
    fetchBlogDetail()
  }, [id, navigate])

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file.')
      return
    }
    // Show local preview immediately
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)

    // Upload to server
    setIsUploading(true)
    try {
      const uploaded = await mediaService.uploadMedia(file, 'journal')
      const url = (uploaded as any).url || (uploaded as any).fileUrl || ''
      setFeaturedImage(url)
      toast.success('Image uploaded!')
    } catch {
      toast.error('Image upload failed. The URL will be set from preview only.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImageFile(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleImageFile(file)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const clearImage = () => {
    setFeaturedImage('')
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !content) {
      toast.error('Title and Body Content are required.')
      return
    }

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t)

    const payload = {
      title,
      excerpt: excerpt || undefined,
      content,
      featuredImage: featuredImage || undefined,
      status: 'published' as const,
      tags,
    }

    setIsLoading(true)
    try {
      if (isEditMode && id) {
        await blogService.updateBlog(id, payload)
        toast.success('Journal post updated!')
      } else {
        await blogService.createBlog(payload, admin?.name || 'Veda Admin')
        toast.success('Journal post published!')
      }
      navigate('/journal')
    } catch (err) {
      toast.error('Operation failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/journal"
          className="p-2 bg-white dark:bg-slate-800 border rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="page-title">{isEditMode ? 'Edit Journal Article' : 'Create Journal Article'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-12">
        {/* Left Column: Article Content */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 space-y-5">
            <h3 className="section-title font-semibold">Article Content</h3>

            {/* Article Title */}
            <div>
              <label className="label">Article Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Top 5 Benefits of Daily Ashwagandha Consumption"
                className="input"
              />
            </div>

            {/* Excerpt */}
            <div>
              <label className="label">Article Summary / Excerpt</label>
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="A brief 1-2 sentence synopsis shown in article listings..."
                className="input h-20"
              />
            </div>

            {/* Body Content */}
            <div>
              <label className="label">Body Content (HTML/Rich-Text ready) *</label>
              <RichTextEditor
                value={content}
                onChange={setContent}
                placeholder="Write your main article content here. You can use heading, bold, bullet points..."
              />
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Featured Image Upload */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title font-semibold">Featured Image</h3>

            {imagePreview ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                <img
                  src={imagePreview}
                  alt="Featured"
                  className="w-full h-44 object-cover"
                />
                {isUploading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="text-white text-sm font-medium animate-pulse">Uploading...</div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white p-1 rounded-full shadow-md transition"
                  title="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex flex-col items-center justify-center gap-3 h-44 rounded-xl border-2 border-dashed cursor-pointer transition-colors
                  ${isDragging
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-slate-300 dark:border-slate-600 hover:border-primary-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
              >
                <div className="p-3 rounded-full bg-slate-100 dark:bg-slate-800">
                  <UploadCloud className="h-6 w-6 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    Click or drag & drop to upload
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">PNG, JPG, WebP — up to 5 MB</p>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {!imagePreview && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 btn-outline text-xs py-2 flex items-center justify-center gap-2"
                >
                  <ImageIcon className="h-4 w-4" />
                  Browse Image
                </button>
                <button
                  type="button"
                  onClick={() => setIsMediaModalOpen(true)}
                  className="flex-1 btn-primary text-xs py-2 flex items-center justify-center gap-2"
                >
                  <ImageIcon className="h-4 w-4" />
                  Media Library
                </button>
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title font-semibold">Tags</h3>
            <div>
              <label className="label">Tags (comma-separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. Skincare, Ayurveda, Glow"
                className="input"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/journal')}
              className="btn-outline flex-1 justify-center py-2.5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || isUploading}
              className="btn-primary flex-1 justify-center py-2.5"
            >
              {isLoading ? 'Publishing...' : isEditMode ? 'Update Article' : 'Publish Article'}
            </button>
           </div>
         </div>
       </form>

       <MediaLibrarySelectModal
         isOpen={isMediaModalOpen}
         onClose={() => setIsMediaModalOpen(false)}
         onSelect={(url) => {
           setFeaturedImage(url)
           setImagePreview(url)
         }}
       />
     </div>
   )
 }
 export default JournalFormPage
