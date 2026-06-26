import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')

  if (!date) {
    return NextResponse.json({ error: 'Missing required date parameter' }, { status: 400 })
  }

  const from = new Date(`${date}T00:00:00`)
  if (Number.isNaN(from.getTime())) {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 })
  }

  const to = new Date(from)
  to.setDate(to.getDate() + 1)

  const supabase = createClient()
  const { data, error } = await supabase
    .from('sales')
    .select('payment_method, total_amount')
    .gte('created_at', from.toISOString())
    .lt('created_at', to.toISOString())
    .eq('is_voided', false)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const result = { cash: 0, coin: 0, till: 0, total: 0 }

  for (const sale of data || []) {
    const amount = Number(sale.total_amount) || 0
    if (sale.payment_method === 'cash') {
      result.cash += amount
    } else if (sale.payment_method === 'coin') {
      result.coin += amount
    } else if (sale.payment_method === 'till') {
      result.till += amount
    }
    result.total += amount
  }

  return NextResponse.json(result)
}
