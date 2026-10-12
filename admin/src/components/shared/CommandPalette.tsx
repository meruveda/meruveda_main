import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Globe, LayoutDashboard, ShoppingCart, Users, Package, Settings, Star, X } from 'lucide-react'
import { ROUTES } from '../../constants/routes'
import { CUSTOMER_WEBSITE_URL } from '../../constants/config'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

interface CommandItem {
  name: string
  shortcut?: string
  icon: React.ComponentType<{ className?: string }>
  action: () => void
  category: string
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands: CommandItem[] = [
    { name: 'Go to Dashboard', icon: LayoutDashboard, action: () => navigate(ROUTES.DASHBOARD), category: 'Navigation' },
    { name: 'View Products List', icon: Package, action: () => navigate(ROUTES.PRODUCTS), category: 'Navigation' },
    { name: 'Add New Product', icon: Package, action: () => navigate(ROUTES.PRODUCTS_ADD), category: 'Catalog' },
    { name: 'View Orders', icon: ShoppingCart, action: () => navigate(ROUTES.ORDERS), category: 'Navigation' },
    { name: 'Manage Customers', icon: Users, action: () => navigate(ROUTES.CUSTOMERS), category: 'Navigation' },
    { name: 'Store Reviews', icon: Star, action: () => navigate(ROUTES.REVIEWS), category: 'Navigation' },
    { name: 'Settings Configuration', icon: Settings, action: () => navigate(ROUTES.SETTINGS), category: 'System' },
    {
      name: 'Open Customer Website',
      icon: Globe,
      action: () => window.open(CUSTOMER_WEBSITE_URL, '_blank'),
      category: 'External',
      shortcut: '↗',
    },
  ]

  // Filter commands
  const filtered = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cmd.category.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Listen to keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) onClose()
        else onClose() // Toggle handled by layout usually, let's keep it safe
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action()
        onClose()
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Palette box */}
      <div
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl animate-scale-in"
      >
        {/* Search header */}
        <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 px-4 py-3">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Type a command or search page..."
            className="flex-1 border-0 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-0 text-sm"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Commands list */}
        <div className="max-h-[320px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">No results found.</div>
          ) : (
            filtered.map((cmd, idx) => {
              const Icon = cmd.icon
              const isSelected = idx === selectedIndex

              return (
                <button
                  key={idx}
                  onClick={() => {
                    cmd.action()
                    onClose()
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-all duration-150
                    ${isSelected
                      ? 'bg-primary-600 text-white shadow-glow'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'}
                  `}
                >
                  <Icon className={`h-4 w-4 flex-shrink-0 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                  <span className="flex-grow font-medium">{cmd.name}</span>
                  {cmd.shortcut ? (
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${isSelected ? 'border-primary-400 bg-primary-700' : 'border-slate-200 dark:border-slate-600 text-slate-400'}`}>
                      {cmd.shortcut}
                    </span>
                  ) : (
                    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${isSelected ? 'bg-primary-700 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
                      {cmd.category}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-4 py-2 text-[10px] text-slate-400">
          <div className="flex gap-2">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
          </div>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  )
}
export default CommandPalette
