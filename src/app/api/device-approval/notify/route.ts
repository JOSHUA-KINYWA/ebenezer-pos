import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth'
import { sendEmail } from '@/lib/email'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function handler(request: NextRequest) {
  try {
    const body = await request.json()
    const cashierName = String(body.cashierName || 'Unknown').trim()
    const cashierEmail = String(body.cashierEmail || '').trim()
    const deviceName = String(body.deviceName || 'Unknown device').trim()
    const ownerEmails: string[] = Array.isArray(body.ownerEmails) ? body.ownerEmails.filter(Boolean) : []

    if (ownerEmails.length === 0) {
      return NextResponse.json({ error: 'Owner emails are required' }, { status: 400 })
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

    const results = await Promise.allSettled(
      ownerEmails.map(email => sendEmail(email, subject, html))
    )

    const failures = results.filter(r => r.status === 'rejected').length
    if (failures === ownerEmails.length) {
      throw new Error('Failed to send notification to all owners')
    }

    return NextResponse.json({ ok: true, sent: ownerEmails.length - failures, failed: failures })
  } catch (error) {
    console.error('Failed to send device approval notification:', error)
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}

export const POST = withAuth(handler)
