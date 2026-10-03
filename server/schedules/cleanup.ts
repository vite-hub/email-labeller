import { defineSchedule } from 'vite-hub/schedule'
import { cleanup } from '../lib/cleanup'

/** Applies `cleanup` rules once a day. Nothing moves to Trash while cleanup is disabled. */
export default defineSchedule({
  cron: '0 4 * * *',
  async handler() {
    await cleanup()
  },
})
