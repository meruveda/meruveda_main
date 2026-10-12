import React, { useState, useEffect } from 'react'
import { Folder, FileImage, Upload, Trash2, Copy, Eye, RefreshCw } from 'lucide-react'
import { mediaService } from '../../services/mediaService'
import { MediaFile } from '../../types'
import { formatFileSize, formatDate } from '@meruveda/shared'
import { Modal } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

export const MediaLibraryPage: React.FC = () => {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [isLoading, setIsLoading] = useState(true)



  // Preview Modal
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null)

  const fetchFiles = async () => {
    setIsLoading(true)
    try {
      const data = await mediaService.getFiles(
        undefined,
        undefined
      )
      setFiles(data)
    } catch (err) {
      toast.error('Failed to load media library')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchFiles()
  }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0) return

    setIsLoading(true)
    try {
      await mediaService.uploadFile(list[0], 'general-media')
      toast.success('File uploaded successfully!')
      fetchFiles()
    } catch (err) {
      toast.error('Upload failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await mediaService.deleteFile(id)
      toast.success('File deleted from library')
      fetchFiles()
    } catch (err) {
      toast.error('Failed to delete file')
    }
  }

  const copyUrlToClipboard = (url: string) => {
    navigator.clipboard.writeText(url)
    toast.success('Image URL copied to clipboard!')
  }

  const openPreview = (file: MediaFile) => {
    setPreviewFile(file)
    setIsPreviewOpen(true)
  }

  const totalUsedSize = files.reduce((acc, file) => acc + (Number(file.size) || 0), 0)
  const totalLimit = 100 * 1024 * 1024 // 100 MB limit
  const percentUsed = Math.min((totalUsedSize / totalLimit) * 100, 100)
  const remainingSize = Math.max(totalLimit - totalUsedSize, 0)

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Media Library</h1>
          <p className="text-sm text-slate-500">
            Upload, compress, and organize promotional banner files, logos, and catalog images.
          </p>
        </div>

        {/* Upload Button */}
        <label className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl cursor-pointer shadow-glow">
          <Upload className="h-4 w-4" /> Upload Image
          <input type="file" onChange={handleFileUpload} className="hidden" accept="image/*" />
        </label>
      </div>

      {/* Storage Indicator */}
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-100 dark:border-slate-800">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-playfair">Storage Usage</div>
          <div className="text-xs text-slate-500">
            Using <span className="font-bold text-slate-700 dark:text-slate-300">{formatFileSize(totalUsedSize)}</span> of <span className="font-bold">100 MB</span> ({formatFileSize(remainingSize)} remaining)
          </div>
        </div>
        <div className="flex-1 max-w-md w-full">
          <div className="w-full bg-slate-100 dark:bg-slate-850 rounded-full h-2 overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                percentUsed > 90 ? 'bg-red-500' : percentUsed > 70 ? 'bg-amber-500' : 'bg-primary-500'
              }`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <div className="flex justify-end text-[10px] text-slate-400 mt-1 font-semibold">{percentUsed.toFixed(1)}% Used</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Right column: Grid list */}
        <div className="space-y-4">


          {/* Grid listing */}
          {isLoading ? (
            <div className="flex h-48 items-center justify-center card">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-350" />
            </div>
          ) : files.length === 0 ? (
            <div className="card p-12 text-center text-slate-400">No media assets in this folder.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {files.map((file) => (
                <div key={file.id} className="card overflow-hidden group flex flex-col justify-between relative border border-slate-100 dark:border-slate-800">
                  {/* Image wrapper */}
                  <div className="aspect-square bg-slate-50 relative flex items-center justify-center overflow-hidden border-b">
                    <img src={file.url} alt={file.name || (file as any).filename || 'Media'} className="h-full w-full object-cover" />
                    {/* Hover actions panel overlay */}
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 transition-opacity">
                      <button
                        onClick={() => openPreview(file)}
                        className="p-2 bg-white rounded-xl text-slate-700 hover:text-primary-600 transition-colors shadow"
                        title="Preview"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => copyUrlToClipboard(file.url)}
                        className="p-2 bg-white rounded-xl text-slate-700 hover:text-primary-600 transition-colors shadow"
                        title="Copy URL"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(file.id)}
                        className="p-2 bg-white rounded-xl text-slate-700 hover:text-red-500 transition-colors shadow"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="p-3 text-[11px] space-y-0.5">
                    <p className="font-semibold text-slate-900 dark:text-white truncate" title={file.name || (file as any).filename || ''}>
                      {file.name || (file as any).filename || ''}
                    </p>
                    <div className="flex justify-between text-slate-400">
                      <span>{formatFileSize(file.size)}</span>
                      <span>{formatDate(file.uploadedAt || (file as any).created_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      <Modal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title={previewFile?.name || (previewFile as any)?.filename || ''}>
        {previewFile && (
          <div className="space-y-4">
            <div className="aspect-video bg-slate-50 border rounded-2xl overflow-hidden flex items-center justify-center">
              <img src={previewFile.url} alt={previewFile.name || (previewFile as any).filename || 'Media'} className="max-h-full object-contain" />
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Resolution URL</span>
                <button
                  onClick={() => copyUrlToClipboard(previewFile.url)}
                  className="text-primary-600 font-bold hover:underline"
                >
                  Copy Link Address
                </button>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">File Size</span>
                <span className="font-semibold">{formatFileSize(previewFile.size)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Format MIME</span>
                <span className="font-semibold">{previewFile.mimeType || (previewFile as any).mime_type}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
export default MediaLibraryPage
