"use client"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getTranslation, normalizeLocale, type Locale } from './translate'
const LocaleContext = createContext({ locale: 'en' as Locale, setLocale: (_locale: Locale) => {} })
export function LocaleProvider({ initialLocale = 'en', children }: { initialLocale?: Locale; children: React.ReactNode }) {
  const [locale, changeLocale] = useState(initialLocale)
  const setLocale = useCallback((value: Locale) => changeLocale(normalizeLocale(value)), [])
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('lang')
    if (requested === 'en' || requested === 'ru') setLocale(requested)
  }, [setLocale])
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = 'ltr'
    document.cookie = `ff_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`
  }, [locale])
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
export function useLocale() { return useContext(LocaleContext) }
export function useTranslation() {
  const { locale } = useLocale()
  return useMemo(() => getTranslation(locale), [locale])
}
