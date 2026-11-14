import { defineEventHandler } from 'h3'
import { getActiveCloudflareEnv } from '@vite-hub/agent/cloudflare'
import { loadAgentHost } from '#vitehub/agent/registry'
import { isAdmin } from '../lib/admin'

interface ChannelStatus {
  status: string
  syncedAt?: string
  failures?: number
  failingSince?: string
}

interface ChannelHost {
  handlers: Record<string, { channelStatus(request: Request, channel: string, options: unknown): Promise<ChannelStatus | undefined> }>
  options(agent: string, env?: Record<string, unknown>): unknown
}

// ViteHub has no public server API for a Channel's sync status yet. The Console's `channels.status` operation and
// pollGmailChannel() read it from the Channel host that the generated webhook routes install in this process slot.
const hostKey = Symbol.for('vitehub.agent.channels-console')

export default defineEventHandler(async (event) => {
  await loadAgentHost()
  const host = (globalThis as Record<symbol, ChannelHost | undefined>)[hostKey]
  const health = await host?.handlers.labeller?.channelStatus(event.req, 'gmail', host.options('labeller', getActiveCloudflareEnv()))
  if (!health) {
    event.res.status = 503
    return { status: 'unavailable' }
  }
  if (health.status !== 'ok') event.res.status = 503
  if (isAdmin(event)) return health
  return { status: health.status, syncedAt: health.syncedAt, failures: health.failures, failingSince: health.failingSince }
})
