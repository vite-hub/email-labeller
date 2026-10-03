import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { useServerEnv } from '#vitehub/env/server'
import { recordSyncRequest, sync } from '../../lib/sync'

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

/** Gmail push notification: authenticate, persist, then process history after acknowledging. */
export default defineEventHandler(async (event) => {
  const { audience, serviceAccount, subscription } = useServerEnv().pubsub
  if (!audience || !serviceAccount || !subscription) throw createError({ statusCode: 503, message: 'Pub/Sub push is not configured' })

  const token = getHeader(event, 'authorization')?.replace(/^Bearer /, '')
  if (!token) throw createError({ statusCode: 401, message: 'Missing Pub/Sub token' })
  try {
    const { payload } = await jwtVerify(token, googleKeys, {
      audience,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    })
    if (payload.email !== serviceAccount || payload.email_verified !== true) throw new Error('Unexpected token subject')
  }
  catch {
    throw createError({ statusCode: 401, message: 'Invalid Pub/Sub token' })
  }

  const body = await readBody(event) as { subscription?: unknown, message?: { data?: unknown } } | null
  const encoded = body?.message?.data
  if (body?.subscription !== subscription || typeof encoded !== 'string') {
    throw createError({ statusCode: 400, message: 'Invalid Pub/Sub notification' })
  }
  try {
    const notification = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string, unknown>
    if (typeof notification.emailAddress !== 'string' || !/^\d+$/.test(String(notification.historyId))) {
      throw new Error('Invalid Gmail notification')
    }
  }
  catch {
    throw createError({ statusCode: 400, message: 'Invalid Gmail notification' })
  }

  await recordSyncRequest()
  event.waitUntil(sync().catch(error => console.error('[labeller] sync failed', error)))
  event.res.status = 204
  return null
})
