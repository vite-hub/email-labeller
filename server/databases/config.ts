import { defineDatabase } from 'vite-hub/database'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** One row per mailbox: the Gmail history cursor, the push watch expiry, and the sync lease. */
export const mailbox = sqliteTable('mailbox', {
  id: text('id').primaryKey(),
  historyId: text('history_id').notNull(),
  watchExpiresAt: integer('watch_expires_at', { mode: 'timestamp_ms' }),
  /** While set and in the future, one Worker isolate is syncing this mailbox. */
  syncLeaseUntil: integer('sync_lease_until', { mode: 'timestamp_ms' }),
})

/** Last authenticated push request. A sync that is running checks it before it stops, and the five-minute schedule reconciles it if inline sync fails. */
export const syncRequests = sqliteTable('sync_requests', {
  id: text('id').primaryKey(),
  requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull(),
})

/** One row per processed message. The primary key makes processing idempotent. */
const decisions = sqliteTable('decisions', {
  messageId: text('message_id').primaryKey(),
  from: text('from').notNull(),
  subject: text('subject').notNull(),
  source: text('source', { enum: ['rule', 'jev'] }).notNull(),
  rule: text('rule'),
  jevChoice: text('jev_choice'),
  jevProbability: real('jev_probability'),
  addLabels: text('add_labels', { mode: 'json' }).$type<string[]>().notNull(),
  removeLabels: text('remove_labels', { mode: 'json' }).$type<string[]>().notNull(),
  trash: integer('trash', { mode: 'boolean' }).notNull(),
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull(),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }).notNull(),
})

export default defineDatabase({
  schema: { mailbox, decisions, syncRequests },
})
