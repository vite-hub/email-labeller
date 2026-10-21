import { defineSchedule } from 'vite-hub/schedule'
import { describeError, renewWatch, sync } from '../lib/sync'

/**
 * Renew Gmail push watch when needed and reconcile messages if a notification is missed.
 */
export default defineSchedule({
  cron: '*/5 * * * *',
  async handler() {
    try {
      await renewWatch()
    }
    catch (error) {
      console.error('[labeller] watch renewal failed:', describeError(error))
    }
    try {
      await sync()
    }
    catch (error) {
      // Leave the cursor unchanged so the next five-minute run retries the
      // same work. A failed cron invocation must not stop future recovery.
      console.error('[labeller] scheduled sync failed:', describeError(error))
    }
  },
})
