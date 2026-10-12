import React, { useState, useEffect } from 'react'
import { Bell, Check, Trash2, MailOpen, RefreshCw } from 'lucide-react'
import { notificationService } from '../../services/notificationService'
import { Notification } from '../../types'
import { formatDateTime } from '@meruveda/shared'
import toast from 'react-hot-toast'

export const NotificationsPage: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchNotifications = async () => {
    setIsLoading(true)
    try {
      const data = await notificationService.getNotifications()
      setNotifications(data)
    } catch (err) {
      toast.error('Failed to load notifications')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
  }, [])

  const handleMarkRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id)
      toast.success('Marked as read')
      fetchNotifications()
    } catch (err) {
      toast.error('Operation failed')
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead()
      toast.success('All notifications marked as read')
      fetchNotifications()
    } catch (err) {
      toast.error('Operation failed')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await notificationService.deleteNotification(id)
      toast.success('Notification dismissed')
      fetchNotifications()
    } catch (err) {
      toast.error('Failed to dismiss notification')
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Notification Center</h1>
          <p className="text-sm text-slate-500">View real-time alerts, stock issues, and new client transactions.</p>
        </div>

        {notifications.some((n) => !n.isRead) && (
          <button
            onClick={handleMarkAllRead}
            className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
          >
            <MailOpen className="h-4 w-4" /> Mark All as Read
          </button>
        )}
      </div>

      {/* Notifications list */}
      <div className="card p-6 space-y-4">
        <div className="space-y-3 divide-y divide-slate-100 dark:divide-slate-800">
          {isLoading ? (
            <div className="py-6 text-center text-slate-400">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto text-slate-350" />
            </div>
          ) : notifications.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Your inbox is clear! No notifications.</p>
          ) : (
            notifications.map((not, idx) => (
              <div
                key={not.id}
                className={`pt-4 ${idx === 0 ? 'pt-0' : ''} flex items-start justify-between gap-4`}
              >
                <div className="flex gap-3">
                  <div
                    className={`p-2.5 rounded-xl flex-shrink-0 ${
                      not.isRead
                        ? 'bg-slate-100 text-slate-400 dark:bg-slate-800'
                        : 'bg-purple-50 dark:bg-purple-950/20 text-primary-600'
                    }`}
                  >
                    <Bell className="h-4.5 w-4.5" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4
                        className={`text-sm ${
                          not.isRead ? 'text-slate-655 dark:text-slate-400' : 'font-bold text-slate-900 dark:text-white'
                        }`}
                      >
                        {not.title}
                      </h4>
                      {!not.isRead && <span className="h-1.5 w-1.5 rounded-full bg-primary-600" />}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{not.message}</p>
                    <p className="text-[10px] text-slate-400">{formatDateTime(not.createdAt)}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1">
                  {!not.isRead && (
                    <button
                      onClick={() => handleMarkRead(not.id)}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-green-600"
                      title="Mark Read"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(not.id)}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-red-500"
                    title="Dismiss"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
export default NotificationsPage
