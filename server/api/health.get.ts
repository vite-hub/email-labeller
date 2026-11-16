import { defineEventHandler } from 'h3'
import { gmailChannelStatus } from 'vite-hub/channels/adapters'
import { checkServiceToken } from 'vite-hub/env'
import { gmailChannel } from '../agents/labeller'

export default defineEventHandler(async (event) => {
  const health = await gmailChannelStatus(gmailChannel)
  if (!health) {
    event.res.status = 503
    return { status: 'unavailable' }
  }
  if (health.status !== 'ok') event.res.status = 503
  const [error] = checkServiceToken(event, 'VITEHUB_SECRET')
  if (!error) return health
  return { status: health.status, syncedAt: health.syncedAt, failures: health.failures, failingSince: health.failingSince }
})
