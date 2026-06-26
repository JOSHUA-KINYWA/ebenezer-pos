import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Sale, ShopSettings, SessionUser } from '@/types'
import { format } from 'date-fns'

interface ReceiptOptions {
  sale: Sale
  settings?: ShopSettings
  cashier?: SessionUser | null
}

export function downloadReceipt({ sale, settings, cashier }: ReceiptOptions) {
  const shopName = settings?.shop_name ?? 'Ebenezar Shop'
  const shopAddress = settings?.shop_address ?? 'Nairobi, Kenya'
  const shopPhone = settings?.shop_phone ?? ''
  const currency = settings?.currency ?? 'KSh'
  const footer = settings?.receipt_footer ?? 'Thank you for shopping with us!'

  const doc = new jsPDF({ unit: 'mm', format: [80, 160], orientation: 'portrait' })
  const pageW = 80
  let y = 10

  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(shopName.toUpperCase(), pageW / 2, y, { align: 'center' })
  y += 5

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  if (shopAddress) {
    doc.text(shopAddress, pageW / 2, y, { align: 'center' })
    y += 3.5
  }
  if (shopPhone) {
    doc.text(shopPhone, pageW / 2, y, { align: 'center' })
    y += 3.5
  }
  y += 4

  doc.setLineWidth(0.3)
  doc.line(5, y, 75, y)
  y += 5

  doc.setFontSize(7)
  doc.text(`Receipt: ${sale.receipt_no}`, 5, y)
  y += 3.5
  doc.text(`Date: ${format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm')}`, 5, y)
  y += 3.5
  if (cashier) {
    doc.text(`Cashier: ${cashier.full_name}`, 5, y)
    y += 3.5
  }
  if (sale.customer?.name) {
    doc.text(`Customer: ${sale.customer.name}`, 5, y)
    y += 3.5
  }
  doc.text(
    `Payment: ${
      sale.payment_type === 'mpesa'
        ? 'M-Pesa'
        : sale.payment_type === 'card'
        ? 'Card'
        : 'Cash'
    }`,
    5,
    y
  )
  if (sale.mpesa_ref) {
    y += 3.5
    doc.text(`M-Pesa Ref: ${sale.mpesa_ref}`, 5, y)
  }
  if (sale.card_ref) {
    y += 3.5
    doc.text(`Card Ref: ${sale.card_ref}`, 5, y)
  }
  y += 5

  autoTable(doc, {
    startY: y,
    head: [['Item', 'Qty', 'Price', 'Total']],
    body: (sale.sale_items || []).map(item => [
      item.product_name,
      item.quantity.toString(),
      `${currency} ${item.unit_price.toFixed(0)}`,
      `${currency} ${item.subtotal.toFixed(0)}`,
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [22, 163, 74], fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 10, halign: 'center' },
      2: { cellWidth: 18, halign: 'right' },
      3: { cellWidth: 18, halign: 'right' },
    },
    margin: { left: 5, right: 5 },
    tableWidth: 70,
  })

  const docWithTable = doc as jsPDF & { lastAutoTable: { finalY: number } }
  y = docWithTable.lastAutoTable.finalY + 4

  if (sale.discount > 0) {
    doc.text(`Discount: -${currency} ${sale.discount.toFixed(0)}`, pageW - 5, y, { align: 'right' })
    y += 4
  }

  if (sale.amount_tendered && sale.payment_type === 'cash') {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(`Tendered: ${currency} ${sale.amount_tendered.toFixed(0)}`, pageW - 5, y, { align: 'right' })
    y += 3.5
    doc.text(`Change: ${currency} ${(sale.change_amount ?? 0).toFixed(0)}`, pageW - 5, y, { align: 'right' })
    y += 4
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(`TOTAL: ${currency} ${sale.total_amount.toFixed(0)}`, pageW - 5, y, { align: 'right' })
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.line(5, y, 75, y)
  y += 4
  doc.text(footer, pageW / 2, y, { align: 'center' })

  doc.save(`receipt-${sale.receipt_no}.pdf`)
}
