import { timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import { useServerEnv } from '#vitehub/env/server'

/** Requires `Authorization: Bearer <LABELLER_ADMIN_TOKEN>`. */
export function requireAdmin(event: H3Event): void {
  const expected = useServerEnv().labeller.adminToken?.unseal()
  if (!expected) throw createError({ statusCode: 503, message: 'LABELLER_ADMIN_TOKEN is not configured' })
  const actual = Buffer.from(getHeader(event, 'authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? '')
  const wanted = Buffer.from(expected)
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }
}
