import { defineSchedule } from 'vite-hub/schedule'
import { pollGmailChannel } from 'vite-hub/channels/adapters'
import { gmailChannel } from '../agents/labeller'

export default defineSchedule({
  cron: '*/5 * * * *',
  async handler() {
    await pollGmailChannel(gmailChannel)
  },
})
