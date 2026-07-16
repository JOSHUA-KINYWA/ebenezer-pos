import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth'
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

async function handler(request: NextRequest) {
  const body = await request.json()
  const email = String(body.email || '').trim().toLowerCase()
  const fullName = String(body.fullName || '').trim()
  const status = String(body.status || '').trim()
  const note = String(body.note || '').trim()

  if (!isEmail(email) || !fullName || !['approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Invalid notice payload' }, { status: 400 })
  }

  const approved = status === 'approved'
  const subject = approved ? 'Your Ebenezar POS account was approved' : 'Your Ebenezar POS account request was reviewed'

  await sendEmail(
    email,
    subject,
    `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="color:${approved ? '#16a34a' : '#dc2626'};">Account ${approved ? 'approved' : 'not approved'}</h2>
        <p>Hello ${escapeHtml(fullName)},</p>
        ${
          approved
            ? '<p>Your Ebenezar POS cashier account has been approved. You can now sign in using your email and the PIN provided by the shop owner.</p>'
            : '<p>Your Ebenezar POS account request was not approved at this time.</p>'
        }
        ${note ? `<p><strong>Owner note:</strong> ${escapeHtml(note)}</p>` : ''}
      </div>
    `
  )

  return NextResponse.json({ ok: true })
}

export const POST = withAuth(handler)
