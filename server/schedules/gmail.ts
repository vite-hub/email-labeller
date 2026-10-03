import { defineSchedule } from 'vite-hub/schedule'
import { renewWatch, sync } from '../lib/sync'

/**
 * Renew Gmail push watch when needed and reconcile messages if a notification is missed.
 */
export default defineSchedule({
  cron: '*/5 * * * *',
  async handler() {
    await renewWatch()
    await sync()
  },
})
