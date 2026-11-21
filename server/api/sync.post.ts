import { defineEventHandler } from 'h3'
import { pollGmailChannel } from 'vite-hub/channels/adapters'
import { requireServiceToken } from 'vite-hub/env'
import { gmailChannel } from '../agents/labeller'

export default defineEventHandler(async (event) => {
  requireServiceToken(event, 'VITEHUB_SECRET')
  await pollGmailChannel(gmailChannel)
  return { synced: true }
})
