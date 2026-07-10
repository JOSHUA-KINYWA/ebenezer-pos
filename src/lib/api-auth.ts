import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'

export function withAuth(handler: (request: NextRequest, userId: string) => Promise<NextResponse>) {
  return async (request: NextRequest) => {
    const userId = request.headers.get('x-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient()
    const { data: user, error } = await supabase
      .from('users')
      .select('id, role, is_active')
      .eq('id', userId)
      .maybeSingle()

    if (error || !user || !user.is_active) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return handler(request, user.id)
  }
}
