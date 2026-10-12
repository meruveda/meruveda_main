import React, { useState, useEffect } from 'react'
import { activityService } from '../../services/activityService'
import { ActivityLog, ActivityModule } from '../../types'
import { RefreshCw, Activity, Calendar, ShieldAlert } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export const ActivityLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedModule, setSelectedModule] = useState<ActivityModule | 'all'>('all')

  const fetchLogs = async () => {
    setIsLoading(true)
    try {
      const filterModule = selectedModule === 'all' ? undefined : selectedModule
      const data = await activityService.getLogs({ module: filterModule })
      setLogs(data)
    } catch (err) {
      toast.error('Failed to load activity logs')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [selectedModule])

  const modulesList: { value: ActivityModule | 'all'; label: string }[] = [
    { value: 'all', label: 'All Modules' },
    { value: 'products', label: 'Products' },
    { value: 'categories', label: 'Categories' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'orders', label: 'Orders' },
    { value: 'customers', label: 'Customers' },
    { value: 'reviews', label: 'Reviews' },
    { value: 'coupons', label: 'Coupons' },
    { value: 'media', label: 'Media Library' },
    { value: 'blog', label: 'Blog' },
    { value: 'settings', label: 'Settings' },
    { value: 'admins', label: 'Administrators' },
  ]

  const getModuleBadgeColor = (mod: ActivityModule) => {
    switch (mod) {
      case 'products':
        return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
      case 'categories':
        return 'bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-300'
      case 'inventory':
        return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
      case 'orders':
        return 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300'
      case 'customers':
        return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300'
      case 'reviews':
        return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
      case 'coupons':
        return 'bg-pink-50 text-pink-700 dark:bg-pink-900/20 dark:text-pink-300'
      case 'media':
        return 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
      case 'blog':
        return 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300'
      case 'settings':
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-350'
      case 'admins':
        return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
      default:
        return 'bg-slate-50 text-slate-750 dark:bg-slate-900/20 dark:text-slate-300'
    }
  }

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Activity Logs</h1>
          <p className="text-sm text-slate-500">Audit trail of actions executed by store administrators.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input max-w-xs"
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value as any)}
          >
            {modulesList.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={fetchLogs}
            className="btn-outline px-3 py-2 rounded-xl text-slate-500 hover:text-slate-700"
            title="Refresh logs"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Logs Table / Timeline Card */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/10 text-slate-500 text-xs font-semibold">
                <th className="p-4 w-48">Timestamp</th>
                <th className="p-4 w-40">Admin</th>
                <th className="p-4 w-32">Module</th>
                <th className="p-4 w-48">Action</th>
                <th className="p-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-350" />
                    Fetching audit logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-400">
                    <ShieldAlert className="h-8 w-8 text-slate-350 mx-auto mb-2" />
                    No audit records match the filter.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/10 transition-colors">
                    <td className="p-4 text-slate-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                      </div>
                    </td>
                    <td className="p-4 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                      {log.adminName}
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <span className={`badge ${getModuleBadgeColor(log.module)}`}>
                        {log.module}
                      </span>
                    </td>
                    <td className="p-4 font-medium text-slate-800 dark:text-slate-200">
                      {log.action}
                    </td>
                    <td className="p-4 text-slate-500 break-words max-w-md">
                      {log.details || '-'}
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
export default ActivityLogsPage
