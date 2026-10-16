import { timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { useServerEnv } from '#vitehub/env/server'

/** Requires `Authorization: Bearer <VITEHUB_SECRET>` or the legacy admin token. */
export function requireAdmin(event: H3Event): void {
  const expected = useServerEnv().labeller.adminToken?.unseal()
  if (!expected) throw createError({ statusCode: 503, message: 'No admin secret is configured' })
  const actual = Buffer.from(getHeader(event, 'authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? '')
  const wanted = Buffer.from(expected)
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }
}
