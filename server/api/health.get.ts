import { defineEventHandler } from 'h3'
import { isAdmin } from '../lib/admin'
import { syncHealth } from '../lib/sync'

/** Responds with 503 while sync keeps failing. Admins also get the last error and skipped messages. */
export default defineEventHandler(async (event) => {
  const health = await syncHealth(isAdmin(event))
  if (health.status !== 'ok') event.res.status = 503
  return health
})
