import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }

  return createBrowserClient(url, key)
}

export async function withRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  retries = 2,
  delay = 300
): Promise<{ data: T | null; error: any }> {
  try {
    return await fn()
  } catch (error: any) {
    const msg = error?.message || ''
    const isRetryable =
      msg.includes('ERR_HTTP2_SERVER_REFUSED_STREAM') ||
      msg.includes('Could not establish connection') ||
      msg.includes('NetworkError')

    if (retries > 0 && isRetryable) {
      await new Promise(resolve => setTimeout(resolve, delay))
      return withRetry(fn, retries - 1, delay * 2)
    }
    throw error
  }
}
