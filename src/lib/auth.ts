import { SessionUser, User } from '@/types'

const SESSION_KEY = 'pos_user'
const HELD_CART_KEY = 'pos_held_cart'
const SESSION_INACTIVITY_MS = 6 * 60 * 60 * 1000 // 6 hours

type StoredSession = SessionUser & {
  last_active_at?: string
}

export function toSessionUser(user: Pick<User, 'id' | 'full_name' | 'email' | 'role' | 'is_active'>): SessionUser {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
  }
}

function sessionExpired(stored: StoredSession): boolean {
  if (!stored.last_active_at) return false
  const lastActive = Date.parse(stored.last_active_at)
  if (Number.isNaN(lastActive)) return false
  return Date.now() - lastActive >= SESSION_INACTIVITY_MS
}

export function getSession(): SessionUser | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(SESSION_KEY)
  if (!stored) return null

  try {
    const parsed = JSON.parse(stored) as StoredSession
    if (sessionExpired(parsed)) {
      clearSession()
      return null
    }
    return parsed as SessionUser
  } catch {
    return null
  }
}

export function setSession(user: SessionUser) {
  const stored: StoredSession = {
    ...user,
    last_active_at: new Date().toISOString(),
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored))
}

export function refreshSession() {
  if (typeof window === 'undefined') return
  const stored = localStorage.getItem(SESSION_KEY)
  if (!stored) return
  try {
    const parsed = JSON.parse(stored) as StoredSession
    if (sessionExpired(parsed)) {
      clearSession()
      return
    }
    parsed.last_active_at = new Date().toISOString()
    localStorage.setItem(SESSION_KEY, JSON.stringify(parsed))
  } catch {
    // ignore malformed session
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(HELD_CART_KEY)
}
