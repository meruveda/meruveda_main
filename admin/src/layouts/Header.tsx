import React, { useState, useEffect } from 'react'
import { Menu, Sun, Moon, Bell, Search, Command, LogOut, Settings as SettingsIcon } from 'lucide-react'
import { useSidebar } from '../context/SidebarContext'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import { notificationService } from '../services/notificationService'

interface HeaderProps {
  onSearchClick: () => void
}

export const Header: React.FC<HeaderProps> = ({ onSearchClick }) => {
  const { toggleSidebar } = useSidebar()
  const { theme, toggleTheme } = useTheme()
  const { admin, logout } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  useEffect(() => {
    let isMounted = true
    const fetchNotifications = async () => {
      try {
        const list = await notificationService.getNotifications()
        if (isMounted) {
          setUnreadCount(list.filter((n) => !n.isRead).length)
        }
      } catch (err) {
        console.error(err)
      }
    }
    fetchNotifications()
    return () => {
      isMounted = false
    }
  }, [])

  return (
    <header className="print:hidden sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-6 shadow-sm">
      {/* Left side: Mobile Menu trigger & Search */}
      <div className="flex items-center gap-4 flex-1">
        <button
          onClick={toggleSidebar}
          className="lg:hidden p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Global Search trigger */}
        <button
          onClick={onSearchClick}
          className="flex items-center gap-2 max-w-md w-full md:w-80 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:text-slate-400 transition-all text-sm group"
        >
          <Search className="h-4 w-4 flex-shrink-0 group-hover:scale-105 transition-transform" />
          <span className="flex-1 text-left">Search anything...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-[10px] font-medium text-slate-500 dark:text-slate-300">
            <Command className="h-3 w-3" />
            <span>K</span>
          </kbd>
        </button>
      </div>

      {/* Right side: Dark Mode, Notifications, User Profile */}
      <div className="flex items-center gap-3">
        {/* Dark Mode toggle */}
        <button
          onClick={toggleTheme}
          className="p-2.5 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Toggle Theme"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        {/* Notifications */}
        <Link
          to="/notifications"
          className="relative p-2.5 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Notification Center"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
              {unreadCount}
            </span>
          )}
        </Link>

        {/* Profile */}
        <div className="border-l border-slate-200 dark:border-slate-800 h-6 mx-1" />
        
        {/* Profile Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className="flex items-center gap-2 group focus:outline-none"
          >
            <img
              src={admin?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'}
              alt={admin?.name}
              className="h-8 w-8 rounded-full object-cover ring-2 ring-transparent group-hover:ring-primary-500 transition-all"
            />
            <span className="hidden md:inline text-sm font-medium text-slate-700 dark:text-slate-200 group-hover:text-primary-600 transition-colors">
              {admin?.name}
            </span>
          </button>

          {isProfileOpen && (
            <>
              {/* Overlay to close the dropdown */}
              <div className="fixed inset-0 z-40" onClick={() => setIsProfileOpen(false)} />
              
              <div className="absolute right-0 mt-2 w-52 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-lg z-50 animate-fade-in text-sm text-slate-750 dark:text-slate-200">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">{admin?.name}</p>
                  <p className="text-xs text-slate-400 truncate">{admin?.email}</p>
                  <p className="text-[10px] uppercase font-bold text-primary-500 mt-1">{admin?.role}</p>
                </div>
                <Link
                  to="/settings"
                  onClick={() => setIsProfileOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 mt-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-350 transition-colors"
                >
                  <SettingsIcon className="h-4 w-4" /> Settings
                </Link>
                <button
                  onClick={() => {
                    setIsProfileOpen(false)
                    logout()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 mt-1 rounded-lg text-red-650 hover:bg-red-55 border-none bg-transparent hover:bg-red-50 dark:hover:bg-red-950/20 text-red-600 dark:text-red-400 font-medium transition-colors cursor-pointer text-left"
                >
                  <LogOut className="h-4 w-4" /> Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
export default Header
