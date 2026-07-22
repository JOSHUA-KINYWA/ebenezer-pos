import { SessionUser, User } from '@/types'

const SESSION_KEY = 'pos_user'
const HELD_CART_KEY = 'pos_held_cart'
const DEVICE_KEY = 'pos_device_id'
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

export function getDeviceId() {
  if (typeof window === 'undefined') return ''
  const existing = localStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(DEVICE_KEY, id)
  return id
}

export function getDeviceName() {
  if (typeof window === 'undefined') return 'Unknown device'
  const platform = navigator.platform || 'Device'
  const width = window.screen?.width
  const height = window.screen?.height
  return `${platform}${width && height ? ` ${width}x${height}` : ''}`
}

export async function getDeviceNameFriendly() {
  try {
    const info = await getDetailedDeviceInfo()
    const deviceLabel = info.deviceType || 'Device'
    const browserLabel = info.browserName || 'Unknown browser'
    const resolution = info.screenResolution || ''
    return `${deviceLabel} - ${browserLabel}${resolution ? ` (${resolution})` : ''}`
  } catch {
    return getDeviceName()
  }
}

export async function getDetailedDeviceInfo() {
  if (typeof window === 'undefined') return {
    userAgent: 'Unknown',
    platform: 'Unknown',
    language: 'Unknown',
    timezone: 'Unknown',
    screenResolution: 'Unknown',
    browserName: 'Unknown',
    deviceType: 'Unknown',
  }

  // Get browser and device info
  const userAgent = navigator.userAgent || 'Unknown'
  const platform = navigator.platform || 'Unknown'
  const language = navigator.language || 'Unknown'
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown'
  const screenResolution = window.screen ? `${window.screen.width}x${window.screen.height}` : 'Unknown'

  // Detect browser name
  let browserName = 'Unknown'
  if (userAgent.indexOf('Edg') > -1) browserName = 'Edge'
  else if (userAgent.indexOf('Chrome') > -1) browserName = 'Chrome'
  else if (userAgent.indexOf('Safari') > -1) browserName = 'Safari'
  else if (userAgent.indexOf('Firefox') > -1) browserName = 'Firefox'
  else if (userAgent.indexOf('Opera') > -1 || userAgent.indexOf('OPR') > -1) browserName = 'Opera'

  // Detect device type
  let deviceType = 'Desktop'
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) {
    if (/iPhone|iPod/i.test(userAgent)) deviceType = 'iPhone'
    else if (/iPad/i.test(userAgent)) deviceType = 'iPad'
    else if (/Android/i.test(userAgent)) deviceType = 'Android'
    else deviceType = 'Mobile'
  }

  return {
    userAgent,
    platform,
    language,
    timezone,
    screenResolution,
    browserName,
    deviceType,
  }
}

export async function getDeviceLocationInfo() {
  try {
    const response = await fetch('/api/device-info')
    if (response.ok) {
      return await response.json()
    }
  } catch (error) {
    console.error('Failed to get device location info:', error)
  }

  return {
    ip: 'Unknown',
    location: { country: 'Unknown', city: 'Unknown', timezone: 'Unknown' },
    timestamp: new Date().toISOString(),
  }
}
