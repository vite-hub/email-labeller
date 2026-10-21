import { timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { useServerEnv } from '#vitehub/env/server'

/** Requires `Authorization: Bearer <VITEHUB_SECRET>` or the legacy admin token. */
export function requireAdmin(event: H3Event): void {
  if (!useServerEnv().labeller.adminToken) throw createError({ statusCode: 503, message: 'No admin secret is configured' })
  if (!isAdmin(event)) throw createError({ statusCode: 401, message: 'Unauthorized' })
}

/** True when the request carries the admin bearer token. */
export function isAdmin(event: H3Event): boolean {
  const expected = useServerEnv().labeller.adminToken?.unseal()
  if (!expected) return false
  const actual = Buffer.from(getHeader(event, 'authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? '')
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}
