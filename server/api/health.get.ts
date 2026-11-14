import { defineEventHandler } from 'h3'
import { gmailChannelStatus } from 'vite-hub/agent/channels'
import { gmailChannel } from '../agents/labeller'
import { isAdmin } from '../lib/admin'

export default defineEventHandler(async (event) => {
  const health = await gmailChannelStatus(gmailChannel)
  if (!health) {
    event.res.status = 503
    return { status: 'unavailable' }
  }
  if (health.status !== 'ok') event.res.status = 503
  if (isAdmin(event)) return health
  return { status: health.status, syncedAt: health.syncedAt, failures: health.failures, failingSince: health.failingSince }
})
