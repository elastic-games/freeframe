import { russianMessages } from './messages'
export const LANGUAGES = ['en', 'ru'] as const
export type Locale = (typeof LANGUAGES)[number]
export function normalizeLocale(value?: string | null): Locale {
  return value?.trim().toLowerCase().replace(/_/g, '-').split('-')[0] === 'ru' ? 'ru' : 'en'
}
export function getTranslation(locale: Locale) {
  const tr = (message: string, values?: Record<string, string | number>) => {
    const template = locale === 'ru' ? (russianMessages[message] ?? message) : message
    return values ? template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match)) : template
  }
  return Object.assign(tr, { locale })
}
