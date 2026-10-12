import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useSidebar } from '../context/SidebarContext'
import { CommandPalette } from '../components/shared/CommandPalette'

export const AdminLayout: React.FC = () => {
  const { isCollapsed } = useSidebar()
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div
        className={`flex flex-col min-h-screen transition-all duration-300
          ${isCollapsed ? 'lg:pl-20' : 'lg:pl-64'} print:lg:pl-0
        `}
      >
        {/* Header toolbar */}
        <Header onSearchClick={() => setIsCommandPaletteOpen(true)} />

        {/* Dynamic Nested Page view */}
        <main className="flex-1 p-6 print:p-0 print:max-w-none max-w-7xl w-full mx-auto animate-fade-in">
          <Outlet />
        </main>
      </div>

      {/* Global Command Palette Dialog */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </div>
  )
}
export default AdminLayout
