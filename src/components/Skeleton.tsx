interface SkeletonProps {
  className?: string
  count?: number
}

export function SkeletonLine({ className = '', count = 1 }: SkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`skeleton h-4 w-full ${className}`} />
      ))}
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="card p-6 space-y-4">
      <div className="skeleton h-6 w-1/3" />
      <SkeletonLine count={3} />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton h-4" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(j => (
              <div key={j} className="skeleton h-6" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
