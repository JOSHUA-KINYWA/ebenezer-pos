import { Loader2 } from 'lucide-react'

export function LoadingSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  )
}
