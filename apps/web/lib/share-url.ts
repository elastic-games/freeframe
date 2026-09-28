import { STUDIO_ORIGIN } from '@/lib/studio-embed'

/** Public review links use Studio's guest entry when this instance belongs to Studio. */
export function shareUrl(token: string, frontendOrigin: string): string {
  const origin = process.env.NEXT_PUBLIC_STUDIO_SSO_ENABLED === 'true' ||
    process.env.NEXT_PUBLIC_STUDIO_MANAGED_REVIEWS === 'true'
    ? STUDIO_ORIGIN
    : frontendOrigin
  return `${origin}/share/${token}`
}
