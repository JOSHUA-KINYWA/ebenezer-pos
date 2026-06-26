'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { DEFAULT_SHOP_SETTINGS, ShopSettings } from '@/types'

const CACHE_KEY = 'pos_shop_settings'

export function useShopSettings() {
  const [settings, setSettings] = useState<ShopSettings>(DEFAULT_SHOP_SETTINGS)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('shop_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (!error && data) {
      setSettings(data as ShopSettings)
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    } else {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        try {
          setSettings(JSON.parse(cached))
        } catch {
          setSettings(DEFAULT_SHOP_SETTINGS)
        }
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  async function saveSettings(next: ShopSettings) {
    const supabase = createClient()
    const payload = {
      shop_name: next.shop_name,
      shop_address: next.shop_address,
      shop_phone: next.shop_phone,
      currency: next.currency,
      receipt_footer: next.receipt_footer,
      tax_rate: next.tax_rate,
      updated_at: new Date().toISOString(),
    }

    if (settings.id) {
      const { data, error } = await supabase
        .from('shop_settings')
        .update(payload)
        .eq('id', settings.id)
        .select()
        .single()
      if (!error && data) {
        setSettings(data as ShopSettings)
        localStorage.setItem(CACHE_KEY, JSON.stringify(data))
        return { ok: true }
      }
      return { ok: false, error: error?.message }
    }

    const { data, error } = await supabase
      .from('shop_settings')
      .insert(payload)
      .select()
      .single()

    if (!error && data) {
      setSettings(data as ShopSettings)
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      return { ok: true }
    }
    return { ok: false, error: error?.message }
  }

  return { settings, loading, saveSettings, refresh: fetchSettings }
}
