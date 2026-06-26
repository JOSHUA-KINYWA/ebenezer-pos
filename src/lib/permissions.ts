import { Role } from '@/types'

export const OWNER_ONLY_ROUTES = [
  '/dashboard/expenses',
  '/dashboard/staff',
  '/dashboard/settings',
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
