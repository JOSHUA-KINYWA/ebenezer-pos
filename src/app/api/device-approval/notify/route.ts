import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const cashierName = String(body.cashierName || 'Unknown').trim()
    const cashierEmail = String(body.cashierEmail || '').trim()
    const deviceName = String(body.deviceName || 'Unknown device').trim()

    if (!cashierEmail) {
      return NextResponse.json({ error: 'Cashier email is required' }, { status: 400 })
    }

    const subject = 'New device approval request - Ebenezar POS'

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="color: #dc2626;">New Device Approval Request</h2>
        <p>A cashier is trying to sign in from a new device and needs your approval.</p>
        <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Cashier:</strong> ${escapeHtml(cashierName)}</p>
          <p style="margin: 4px 0;"><strong>Email:</strong> ${escapeHtml(cashierEmail)}</p>
          <p style="margin: 4px 0;"><strong>Device:</strong> ${escapeHtml(deviceName)}</p>
        </div>
        <p>Go to <a href="/dashboard/staff" style="color: #2563eb;">Staff Management</a> to review and approve this device.</p>
      </div>
    `

    await sendEmail(cashierEmail, subject, html)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to send device approval notification:', error)
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
