import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { withAuth } from '@/lib/api-auth'

async function handler(request: Request, userId: string) {
  try {
    const body = await request.json()
    const { saleId, customerEmail, items, subtotal, total, date } = body

    if (!customerEmail) {
      return NextResponse.json({ success: false, error: 'Customer email required' }, { status: 400 })
    }

    const smtpKey = process.env.BREVO_SMTP_KEY
    const smtpUser = process.env.BREVO_SMTP_USER
    if (!smtpKey || !smtpUser) {
      return NextResponse.json({ success: false, error: 'BREVO_SMTP_KEY and BREVO_SMTP_USER must be configured' }, { status: 500 })
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: {
        user: smtpUser,
        pass: smtpKey,
      },
    })

    const escapeHtml = (text: string) =>
      text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')

    const itemsHtml = (items || []).map((i: any) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(String(i.name || ''))}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${Number(i.quantity)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${Number(i.price).toLocaleString()}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${Number(i.total).toLocaleString()}</td>
      </tr>`).join('')

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #16a34a;">Receipt ${saleId ? saleId.slice(0, 8).toUpperCase() : ''}</h2>
        <p>Date: ${date ? new Date(date).toLocaleString() : new Date().toLocaleString()}</p>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f5f5f5;">
              <th style="padding: 8px; text-align: left;">Item</th>
              <th style="padding: 8px;">Qty</th>
              <th style="padding: 8px; text-align: right;">Price</th>
              <th style="padding: 8px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div style="margin-top: 20px; text-align: right;">
          <p style="font-size: 18px; font-weight: bold;">Total: ${Number(total || 0).toLocaleString()}</p>
        </div>
        <p style="margin-top: 20px; color: #666; font-size: 12px;">Thank you for shopping with us!</p>
      </div>`

    const info = await transporter.sendMail({
      from: `"Ebenezar POS" <${smtpUser}>`,
      to: customerEmail,
      subject: `Receipt ${saleId ? saleId.slice(0, 8).toUpperCase() : ''}`,
      html,
    })

    transporter.close()

    return NextResponse.json({
      success: true,
      messageId: info.messageId,
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 })
  }
}

export const POST = withAuth(handler)