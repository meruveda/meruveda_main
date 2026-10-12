import React, { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { mediaService } from '../../services/mediaService'
import { MediaFile } from '../../types'
import { formatFileSize } from '@meruveda/shared'
import { Search, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface MediaLibrarySelectModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (url: string) => void
  title?: string
}

export const MediaLibrarySelectModal: React.FC<MediaLibrarySelectModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  title = 'Select Image from Media Library'
}) => {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchFiles()
    }
  }, [isOpen])

  const fetchFiles = async () => {
    setIsLoading(true)
    try {
      const data = await mediaService.getFiles()
      setFiles(data)
    } catch (err) {
      toast.error('Failed to load media library')
    } finally {
      setIsLoading(false)
    }
  }

  const filteredFiles = files.filter(file => {
    const fileName = file.name || (file as any).filename || ''
    return fileName.toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xxl">
      <div className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search media files by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2">
            <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
            <p className="text-xs text-slate-400">Loading media library...</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-slate-400">
            No files found matching your search.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-h-[50vh] overflow-y-auto pr-1">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                onClick={() => {
                  onSelect(file.url)
                  onClose()
                }}
                className="group relative border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden cursor-pointer hover:border-primary-500 hover:ring-2 hover:ring-primary-500/20 bg-slate-50 dark:bg-slate-800 transition-all flex flex-col justify-between"
              >
                <div className="aspect-square w-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-2 overflow-hidden relative">
                  <img
                    src={file.url}
                    alt={file.name || (file as any).filename || 'Media Image'}
                    className="max-h-full max-w-full object-contain"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="bg-primary-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-lg">
                      Select
                    </span>
                  </div>
                </div>
                <div className="p-2 border-t border-slate-100 dark:border-slate-700">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate" title={file.name || (file as any).filename || ''}>
                    {file.name || (file as any).filename || ''}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {formatFileSize(file.size)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
