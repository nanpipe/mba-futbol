/**
 * Call an internal API route from another API route.
 * Attaches the X-Internal-Secret header so protected routes accept the request.
 */
export function internalFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const secret = process.env.INTERNAL_API_SECRET ?? ''
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
      ...(options.headers ?? {}),
    },
  })
}
