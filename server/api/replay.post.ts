import { eq } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { useServerEnv } from '#vitehub/env/server'
import { useDatabase } from 'vite-hub/database/drizzle'
import { requireAdmin } from '../lib/admin'
import { processMessages } from '../lib/sync'

/** Apply previously recorded dry-run decisions after live mode is enabled. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  if (useServerEnv().labeller.dryRun) {
    throw createError({ statusCode: 409, message: 'Replay requires live mode' })
  }
  const { db, schema } = useDatabase('default')
  const pending = await db.select({ id: schema.decisions.messageId }).from(schema.decisions)
    .where(eq(schema.decisions.dryRun, true)).limit(100)
  return { decisions: await processMessages(pending.map(row => row.id)) }
})
