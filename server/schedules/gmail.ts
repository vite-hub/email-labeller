import { defineSchedule } from 'vite-hub/schedule'
import { pollGmailChannel } from 'vite-hub/agent/channels'
import { gmailChannel } from '../agents/labeller'

export default defineSchedule({
  cron: '*/5 * * * *',
  async handler() {
    await pollGmailChannel(gmailChannel)
  },
})
