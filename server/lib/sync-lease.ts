import { and, eq, gt, isNull, lt, or } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { mailbox, syncRequests } from '../databases/config.ts'

/** Any async SQLite database: the D1 runtime database, or a test database. */
type Database<TResult, TSchema extends Record<string, unknown>> = BaseSQLiteDatabase<'async', TResult, TSchema>

/** Long enough for a five-minute schedule run. A lease left by a killed isolate expires after it. */
export const syncLeaseMs = 5 * 60 * 1000

/**
 * Claims a mailbox for one sync across Worker isolates. Returns the lease expiry, which also identifies the claim, or
 * `undefined` while another sync holds an unexpired lease. The first claim creates the mailbox with the cursor from
 * `startHistoryId`, so the app never labels the whole mailbox.
 */
export async function claimSync<TResult, TSchema extends Record<string, unknown>>(db: Database<TResult, TSchema>, id: string, startHistoryId: () => Promise<string>, now = new Date()): Promise<Date | undefined> {
  const lease = new Date(now.getTime() + syncLeaseMs)
  const claimed = await db.update(mailbox).set({ syncLeaseUntil: lease })
    .where(and(eq(mailbox.id, id), or(isNull(mailbox.syncLeaseUntil), lt(mailbox.syncLeaseUntil, now))))
    .returning({ id: mailbox.id })
  if (claimed.length) return lease
  const [existing] = await db.select({ id: mailbox.id }).from(mailbox).where(eq(mailbox.id, id))
  if (existing) return undefined
  const created = await db.insert(mailbox)
    .values({ id, historyId: await startHistoryId(), syncLeaseUntil: lease })
    .onConflictDoNothing()
    .returning({ id: mailbox.id })
  return created.length ? lease : undefined
}

/** Releases the lease unless it expired and another sync claimed the mailbox. */
export async function releaseSync<TResult, TSchema extends Record<string, unknown>>(db: Database<TResult, TSchema>, id: string, lease: Date): Promise<void> {
  await db.update(mailbox).set({ syncLeaseUntil: null })
    .where(and(eq(mailbox.id, id), eq(mailbox.syncLeaseUntil, lease)))
}

/** Whether a push notification for the mailbox arrived after `since`. */
export async function requestedSince<TResult, TSchema extends Record<string, unknown>>(db: Database<TResult, TSchema>, id: string, since: Date): Promise<boolean> {
  const [request] = await db.select({ id: syncRequests.id }).from(syncRequests)
    .where(and(eq(syncRequests.id, id), gt(syncRequests.requestedAt, since)))
  return request !== undefined
}
