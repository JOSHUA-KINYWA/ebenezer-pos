export function formatMoney(amount: number, currency = 'KSh') {
  return `${currency} ${amount.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function formatProductName(product: { name: string; variety?: string | null; description?: string | null }) {
  const base = product.name
  const variant = product.variety || product.description
  return variant ? `${base} — ${variant}` : base
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(date: string | Date) {
  return new Date(date).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
