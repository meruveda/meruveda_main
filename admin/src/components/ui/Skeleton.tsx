import React from 'react'
import clsx from 'clsx'

interface SkeletonProps {
  className?: string
}

export const Skeleton: React.FC<SkeletonProps> = ({ className }) => {
  return (
    <div
      className={clsx(
        'animate-pulse rounded bg-slate-200 dark:bg-slate-700',
        className
      )}
    />
  )
}

export const CardSkeleton: React.FC = () => {
  return (
    <div className="card p-6 flex items-center justify-between">
      <div className="space-y-2 flex-1 mr-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
      <Skeleton className="h-12 w-12 rounded-2xl flex-shrink-0" />
    </div>
  )
}

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => {
  return (
    <div className="w-full space-y-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center justify-between py-2 border-b dark:border-slate-800">
          <Skeleton className="h-6 w-1/4" />
          <Skeleton className="h-6 w-1/6" />
          <Skeleton className="h-6 w-1/6" />
          <Skeleton className="h-6 w-1/12" />
        </div>
      ))}
    </div>
  )
}
export default Skeleton
