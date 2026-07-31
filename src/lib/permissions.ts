import { Role } from '@/types'

export const OWNER_ONLY_ROUTES = [
  '/dashboard/categories',
  '/dashboard/products',
  '/dashboard/reports',
  '/dashboard/stock',
  '/dashboard/staff',
  '/dashboard/settings',
  '/dashboard/drawer',
  '/dashboard/expenses',
]

export function isOwner(role?: Role) {
  return role === 'owner'
}

export function canAccessRoute(pathname: string, role?: Role) {
  if (!role) return false
  if (role === 'owner') return true
  return !OWNER_ONLY_ROUTES.some(route => pathname.startsWith(route))
}

export function canManageCatalog(role?: Role) {
  return role === 'owner'
}

export function canManageStaff(role?: Role) {
  return role === 'owner'
}

export function canVoidSales(role?: Role) {
  return role === 'owner'
}

export function canEditSales(role?: Role) {
  return role === 'owner'
}
