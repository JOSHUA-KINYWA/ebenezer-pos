'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RoleGuard } from '@/components/RoleGuard'

export default function StockAnalysisPage() {
  const router = useRouter()
  const [redirecting, setRedirecting] = useState(true)

  useEffect(() => {
    router.replace('/dashboard/stock?tab=analysis')
    setRedirecting(false)
  }, [router])

  if (!redirecting) return null
  return (
    <RoleGuard allowed={['owner']}>
      <div className="flex items-center justify-center h-full py-20 text-slate-500">Redirecting to stock analysis...</div>
    </RoleGuard>
  )
}
