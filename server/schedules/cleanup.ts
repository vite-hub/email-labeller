import { defineSchedule } from 'vite-hub/schedule'
import { cleanup } from '../lib/cleanup'
import { settings } from '../lib/settings'

export default defineSchedule({
  cron: '0 4 * * *',
  manual: true,
  async handler() {
    if (!settings.LABELLER_CLEANUP_ENABLED || settings.LABELLER_DRY_RUN) return
    await cleanup()
  },
})
