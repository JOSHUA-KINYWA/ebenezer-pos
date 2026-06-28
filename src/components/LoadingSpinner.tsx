import { Loader2 } from 'lucide-react'

export function LoadingSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="rounded-full border-2 border-brand-200 border-t-brand-600 p-2 animate-spin">
        <Loader2 className="w-8 h-8 text-brand-600" />
      </div>
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  )
}
