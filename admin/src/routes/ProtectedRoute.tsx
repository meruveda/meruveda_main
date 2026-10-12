import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ROUTES } from '../constants/routes'
import { TableSkeleton } from '../components/ui/Skeleton'

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-12 bg-slate-50 dark:bg-slate-900">
        <div className="w-full max-w-2xl text-center space-y-4">
          <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">Loading session...</h2>
          <TableSkeleton rows={4} />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    // Save previous path to redirect back on successful login
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />
  }

  return <>{children}</>
}
export default ProtectedRoute
