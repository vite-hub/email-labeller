import { useServerEnv } from '#vitehub/env/server'
import { defineSchedule } from 'vite-hub/schedule'
import { cleanup } from '../lib/cleanup'

/** Applies `cleanup` rules once a day. Nothing moves to Trash while cleanup is disabled. */
export default defineSchedule({
  cron: '0 4 * * *',
  // Allow `vitehub schedule run cleanup --url ...` for the initial stale-mail pass.
  manual: true,
  async handler() {
    const { cleanupEnabled, dryRun } = useServerEnv().labeller
    if (!cleanupEnabled || dryRun) return
    await cleanup()
  },
})
