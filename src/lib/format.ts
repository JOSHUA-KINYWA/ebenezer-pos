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

export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatSaleAttribution(user?: { full_name?: string; role?: string } | null) {
  if (!user?.full_name) return 'Unknown'
  return user.role === 'owner' ? `${user.full_name} (Owner)` : user.full_name
}

export function normalizeSaleUser(user?: { full_name?: string; role?: string } | { full_name?: string; role?: string }[] | null) {
  if (!user) return undefined
  return Array.isArray(user) ? user[0] : user
}
