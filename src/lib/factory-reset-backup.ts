import { createClient } from '@/lib/supabase'
import { Product, Category } from '@/types'

export interface FactoryResetBackup {
  exportedAt: string
  shopName: string
  products: Product[]
  categories: Category[]
  stockLog: any[]
  customers: any[]
  expenses: any[]
  drawerBalances: any[]
  shifts: any[]
}

export async function exportFactoryResetBackup(): Promise<FactoryResetBackup> {
  const supabase = createClient()

  const { data: settings } = await supabase
    .from('shop_settings')
    .select('shop_name')
    .maybeSingle()

  const { data: products } = await supabase
    .from('products')
    .select('*')
    .order('name')

  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .order('name')

  const { data: stockLog } = await supabase
    .from('stock_log')
    .select('*')
    .order('created_at')

  const { data: customers } = await supabase
    .from('customers')
    .select('*')
    .order('name')

  const { data: expenses } = await supabase
    .from('expenses')
    .select('*')
    .order('expense_date')

  const { data: drawerBalances } = await supabase
    .from('drawer_balances')
    .select('*')
    .order('date')

  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .order('opened_at')

  return {
    exportedAt: new Date().toISOString(),
    shopName: settings?.shop_name || 'Shop',
    products: products || [],
    categories: categories || [],
    stockLog: stockLog || [],
    customers: customers || [],
    expenses: expenses || [],
    drawerBalances: drawerBalances || [],
    shifts: shifts || [],
  }
}

export function downloadBackupFile(backup: FactoryResetBackup) {
  const timestamp = new Date(backup.exportedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `factory-backup-${timestamp}.json`

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function downloadCsvFile(backup: FactoryResetBackup) {
  const timestamp = new Date(backup.exportedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `factory-backup-${timestamp}.zip`
  const zip = buildCsvZip(backup)
  const blob = new Blob([zip], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function buildCsvZip(backup: FactoryResetBackup): string {
  const files: string[] = []
  const escapeCsv = (value: any) => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`
    }
    return text
  }

  const toCsv = (rows: any[], keys: string[]) => {
    const header = keys.map(escapeCsv).join(',') + '\n'
    const body = rows.map(row => keys.map(key => escapeCsv(row[key])).join(',')).join('\n')
    return header + body
  }

  files.push('--- products.csv ---\n' + toCsv(backup.products, ['id', 'name', 'barcode', 'variety', 'description', 'category_id', 'parent_product_id', 'price', 'cost_price', 'unit', 'initial_stock', 'stock_qty', 'stock_alert', 'reorder_qty', 'is_active', 'created_at']))
  files.push('--- categories.csv ---\n' + toCsv(backup.categories, ['id', 'name', 'description', 'is_active', 'created_at']))
  files.push('--- stock_log.csv ---\n' + toCsv(backup.stockLog, ['id', 'product_id', 'user_id', 'change_qty', 'reason', 'note', 'reference_id', 'created_at']))
  files.push('--- customers.csv ---\n' + toCsv(backup.customers, ['id', 'name', 'phone', 'email', 'address', 'credit_limit', 'credit_balance', 'is_active', 'created_at']))
  files.push('--- expenses.csv ---\n' + toCsv(backup.expenses, ['id', 'item_name', 'amount', 'payment_method', 'payment_note', 'expense_date', 'created_by', 'created_at', 'cash_deducted', 'coin_deducted', 'till_deducted']))
  files.push('--- drawer_balances.csv ---\n' + toCsv(backup.drawerBalances, ['id', 'date', 'shift_id', 'cash', 'coin', 'till', 'note', 'updated_at', 'created_at']))
  files.push('--- shifts.csv ---\n' + toCsv(backup.shifts, ['id', 'user_id', 'opened_at', 'closed_at', 'opening_balance', 'expected_balance', 'actual_balance', 'variance', 'status', 'notes', 'created_at']))

  return files.join('\n\n')
}
