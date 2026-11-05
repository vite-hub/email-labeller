import { defineEventHandler } from 'h3'
import { pollGmailChannel } from 'vite-hub/agent/channels'
import { gmailChannel } from '../agents/labeller'
import { requireAdmin } from '../lib/admin'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  await pollGmailChannel(gmailChannel)
  return { synced: true }
})
