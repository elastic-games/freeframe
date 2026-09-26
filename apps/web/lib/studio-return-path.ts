/** Only return to dashboard routes on this instance after Studio sign-in. */
export function studioReturnPath(value: string | null): string {
  if (!value || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/projects'
  try {
    const url = new URL(value, 'https://freeframe.invalid')
    if (url.origin !== 'https://freeframe.invalid' || !/^\/(projects|notifications|settings)(\/|$)/.test(url.pathname)) return '/projects'
    return url.pathname + url.search
  } catch {
    return '/projects'
  }
}
