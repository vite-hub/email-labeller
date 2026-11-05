import { defineEventHandler } from 'h3'
import { getActiveCloudflareEnv } from '@vite-hub/agent/cloudflare'
import { agentChannelOperations } from '@vite-hub/agent/operations'
import { loadChannelsHost } from '#vitehub/agent/registry'
import { isAdmin } from '../lib/admin'

export default defineEventHandler(async (event) => {
  await loadChannelsHost()
  const operation = agentChannelOperations[4]
  const health = await operation.run({ agent: 'labeller', channel: 'gmail' }, {
    access: { mode: 'admin', sections: 'all' }, user: null, surface: 'console', request: event.req, env: getActiveCloudflareEnv(),
  })
  if (health.status !== 'ok') event.res.status = 503
  if (isAdmin(event)) return health
  return { status: health.status, syncedAt: health.syncedAt, failures: health.failures, failingSince: health.failingSince }
})
