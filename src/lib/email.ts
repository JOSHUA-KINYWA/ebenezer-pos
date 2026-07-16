import nodemailer from 'nodemailer'

let transporter: nodemailer.Transporter | null = null

export function getEmailTransporter() {
  if (transporter) return transporter
  const smtpKey = process.env.BREVO_SMTP_KEY
  const smtpUser = process.env.BREVO_SMTP_USER
  if (!smtpKey || !smtpUser) {
    console.warn('BREVO_SMTP_KEY and BREVO_SMTP_USER must be configured')
    return null
  }
  transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: smtpUser,
      pass: smtpKey,
    },
  })
  return transporter
}

export async function sendEmail(to: string, subject: string, html: string) {
  const t = getEmailTransporter()
  if (!t) throw new Error('Email not configured')
  const from = `"Ebenezar POS" <${process.env.SHOP_EMAIL || process.env.BREVO_SMTP_USER}>`
  return t.sendMail({ from, to, subject, html })
}

export async function sendReceiptEmail(to: string, receiptData: {
  receiptNo: string
  items: { name: string; quantity: number; price: number; total: number }[]
  subtotal: number
  total: number
  date: string
}) {
  const itemsHtml = receiptData.items.map(i => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${i.name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${Number(i.quantity)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${Number(i.price).toLocaleString()}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${Number(i.total).toLocaleString()}</td>
    </tr>`).join('')

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #16a34a;">Receipt ${receiptData.receiptNo}</h2>
      <p>Date: ${receiptData.date}</p>
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
        <p style="font-size: 18px; font-weight: bold;">Total: ${Number(receiptData.total).toLocaleString()}</p>
      </div>
      <p style="margin-top: 20px; color: #666; font-size: 12px;">Thank you for shopping with us!</p>
    </div>`

  return sendEmail(to, `Receipt ${receiptData.receiptNo}`, html)
}
