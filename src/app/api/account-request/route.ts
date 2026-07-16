import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { isEmail } from '@/lib/validators'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const fullName = String(body.fullName || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const requestedRole = 'cashier'

    if (!fullName || !isEmail(email)) {
      return NextResponse.json({ error: 'Valid name and email are required' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existingUser) {
      return NextResponse.json({ error: 'This email is already registered. Contact the owner for access.' }, { status: 409 })
    }

    const { data: existingRequest } = await supabase
      .from('pending_accounts')
      .select('id, status')
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle()

    if (existingRequest) {
      return NextResponse.json({ ok: true, alreadyPending: true })
    }

    const { error: insertError } = await supabase
      .from('pending_accounts')
      .insert([{ full_name: fullName, email, requested_role: requestedRole, status: 'pending' }])

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const { data: owners } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('role', 'owner')
      .eq('is_active', true)

    const ownerEmails = (owners || []).map(owner => owner.email).filter(Boolean)
    if (ownerEmails.length > 0) {
      try {
        await sendEmail(
          ownerEmails.join(','),
          'New Ebenezar POS account request',
          `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
              <h2 style="color:#16a34a;">New account request</h2>
              <p>A staff member requested access to Ebenezar POS.</p>
              <table style="width:100%; border-collapse:collapse;">
                <tr><td style="padding:8px; border-bottom:1px solid #eee;">Name</td><td style="padding:8px; border-bottom:1px solid #eee;"><strong>${escapeHtml(fullName)}</strong></td></tr>
                <tr><td style="padding:8px; border-bottom:1px solid #eee;">Email</td><td style="padding:8px; border-bottom:1px solid #eee;">${escapeHtml(email)}</td></tr>
                <tr><td style="padding:8px; border-bottom:1px solid #eee;">Requested role</td><td style="padding:8px; border-bottom:1px solid #eee;">Cashier</td></tr>
              </table>
              <p style="margin-top:16px;">Open Staff in the POS dashboard to approve or reject this request.</p>
            </div>
          `
        )
      } catch (emailError) {
        console.error('Failed to notify owners about account request', emailError)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to submit request' }, { status: 500 })
  }
}
