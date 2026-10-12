import React from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useSidebar } from '../context/SidebarContext'
import { SIDEBAR_GROUPS } from '../constants/sidebar'
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export const Sidebar: React.FC = () => {
  const { isCollapsed, isOpen, toggleCollapse, closeSidebar } = useSidebar()
  const { admin, logout } = useAuth()

  return (
    <>
      {/* Mobile Backdrop overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
        />
      )}

      <aside
        className={`print:hidden fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300
          ${isCollapsed ? 'w-20' : 'w-64'}
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Sidebar Header */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
          <Link to="/dashboard" className="flex items-center gap-2 overflow-hidden px-1" onClick={closeSidebar}>
            {isCollapsed ? (
              <img
                src="/logo_icon_transparent.png"
                alt="MeruVeda"
                className="h-8 w-8 object-contain flex-shrink-0"
              />
            ) : (
              <div className="flex items-center gap-2">
                <img
                  src="/logo_transparent.svg"
                  alt="MeruVeda"
                  className="h-12 w-auto object-contain flex-shrink-0"
                />
                <span className="text-[10px] uppercase tracking-wider font-bold text-primary-400 bg-primary-950/40 px-1.5 py-0.5 rounded border border-primary-800/30">
                  Admin
                </span>
              </div>
            )}
          </Link>

          {/* Collapse toggle (Desktop only) */}
          <button
            onClick={toggleCollapse}
            className="hidden lg:flex h-6 w-6 items-center justify-center rounded-md border border-sidebar-border bg-sidebar hover:bg-sidebar-hover text-sidebar-text hover:text-white transition-colors"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Sidebar Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {SIDEBAR_GROUPS.map((group, groupIdx) => (
            <div key={groupIdx} className="space-y-1">
              {group.title && !isCollapsed && (
                <h3 className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {group.title}
                </h3>
              )}
              {group.items.map((item, itemIdx) => {
                if (item.dividerBefore) {
                  return (
                    <div key={itemIdx} className="pt-2">
                      <div className="border-t border-sidebar-border my-2" />
                      {item.external ? (
                        <a
                          href={item.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="sidebar-item hover:bg-sidebar-hover text-sidebar-text hover:text-white"
                        >
                          <item.icon className="h-5 w-5 flex-shrink-0" />
                          {!isCollapsed && <span>{item.label}</span>}
                        </a>
                      ) : null}
                    </div>
                  )
                }

                return (
                  <NavLink
                    key={itemIdx}
                    to={item.href || '#'}
                    onClick={closeSidebar}
                    className={({ isActive }: { isActive: boolean }) => `
                      sidebar-item
                      ${isActive
                        ? 'bg-sidebar-active text-white shadow-glow'
                        : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'}
                    `}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </div>

        {/* Sidebar Footer / User Profile */}
        <div className="p-3 border-t border-sidebar-border bg-sidebar-hover/40">
          <div className="flex items-center gap-3">
            <img
              src={admin?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop'}
              alt={admin?.name}
              className="h-9 w-9 rounded-full object-cover flex-shrink-0 border border-sidebar-border"
            />
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{admin?.name}</p>
                <p className="text-xs text-sidebar-text truncate capitalize">{admin?.role}</p>
              </div>
            )}
            {!isCollapsed && (
              <button
                onClick={logout}
                title="Logout"
                className="p-1.5 rounded-lg text-sidebar-text hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
export default Sidebar
