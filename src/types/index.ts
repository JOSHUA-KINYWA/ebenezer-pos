export type Role = 'owner' | 'cashier'
export type PaymentType = 'cash' | 'mpesa' | 'card'
export type ExpensePaymentMethod = 'cash' | 'coin' | 'till'
export type StockReason = 'sale' | 'restock' | 'adjustment' | 'damage' | 'return'
export type ShiftStatus = 'open' | 'closed'
export type ReconciliationStatus = 'pending' | 'reconciled' | 'discrepancy'

export interface User {
  id: string
  full_name: string
  email: string
  role: Role
  pin?: string
  is_active: boolean
  last_login?: string
  created_at: string
}

/** Stored in localStorage — never includes PIN */
export interface SessionUser {
  id: string
  full_name: string
  email: string
  role: Role
  is_active: boolean
}

export interface Category {
  id: string
  name: string
  description?: string
  is_active?: boolean
  created_at: string
}

export interface Product {
  id: string
  category_id?: string
  parent_product_id?: string
  barcode?: string
  name: string
  variety?: string
  description?: string
  price: number
  unit: string
  stock_qty: number
  stock_alert: number
  is_active: boolean
  created_at: string
  category?: Category | { name: string }
  variants?: Product[]
}

export interface Sale {
  id: string
  user_id?: string
  shift_id?: string
  customer_id?: string
  subtotal: number
  tax_amount: number
  total_amount: number
  payment_type: PaymentType
  payment_method: 'cash' | 'coin' | 'till'
  mpesa_ref?: string
  card_ref?: string
  discount: number
  receipt_no: string
  created_at: string
  amount_tendered?: number
  change_amount?: number
  note?: string
  is_voided?: boolean
  voided_by?: string
  voided_at?: string
  void_reason?: string
  user?: SessionUser | User
  customer?: Customer
  sale_items?: SaleItem[]
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id?: string
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
  product?: Product
}

export interface Expense {
  id: string
  item_name: string
  vendor?: string
  category?: string
  amount: number
  payment_method: ExpensePaymentMethod
  payment_note?: string
  expense_date: string
  created_by?: string
  created_at: string
}

export interface StockLog {
  id: string
  product_id?: string
  user_id?: string
  change_qty: number
  reason: StockReason
  note?: string
  created_at: string
  product?: Product
  user?: SessionUser | User
}

export interface CartItem {
  product: Product
  quantity: number
  subtotal: number
}

export interface DailySalesSummary {
  sale_date: string
  total_transactions: number
  total_revenue: number
  cash_total: number
  mpesa_total: number
  card_total: number
}

export interface ProductSalesSummary {
  name: string
  unit: string
  units_sold: number
  total_revenue: number
}

export interface ShopSettings {
  id?: string
  shop_name: string
  shop_address: string
  shop_phone: string
  currency: string
  receipt_footer: string
  tax_rate: number
}

export interface Customer {
  id: string
  name: string
  phone?: string
  email?: string
  address?: string
  credit_limit: number
  credit_balance: number
  is_active: boolean
  created_at: string
}

export interface Shift {
  id: string
  user_id?: string
  opened_at: string
  closed_at?: string
  opening_balance: number
  expected_balance?: number
  actual_balance?: number
  variance?: number
  status: ShiftStatus
  notes?: string
  created_at: string
  user?: SessionUser | User
}

export interface AuditLog {
  id: string
  user_id?: string
  action: string
  table_name?: string
  record_id?: string
  old_values?: Record<string, unknown>
  new_values?: Record<string, unknown>
  ip_address?: string
  created_at: string
}

export interface PaymentReconciliation {
  id: string
  date: string
  payment_type: PaymentType
  expected_amount: number
  actual_amount: number
  variance: number
  status: ReconciliationStatus
  reconciled_by?: string
  reconciled_at?: string
  notes?: string
  created_at: string
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  shop_name: 'Ebenezar Shop',
  shop_address: 'Nairobi, Kenya',
  shop_phone: '',
  currency: 'KSh',
  receipt_footer: 'Thank you for shopping with us!',
  tax_rate: 0,
}
