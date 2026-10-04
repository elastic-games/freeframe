import { cookies } from 'next/headers'
import { getTranslation, normalizeLocale } from './translate'
export function getServerTranslation() { return getTranslation(normalizeLocale(cookies().get('ff_locale')?.value)) }
