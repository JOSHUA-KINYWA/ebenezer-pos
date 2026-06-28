import { LoadingSpinner } from '@/components/LoadingSpinner'

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <LoadingSpinner label="Preparing your POS workspace..." />
      </div>
    </div>
  )
}
