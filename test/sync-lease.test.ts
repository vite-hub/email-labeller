import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, beforeEach, describe, it } from 'node:test'
import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { mailbox, syncRequests } from '../server/databases/config.ts'
import { claimSync, releaseSync, requestedSince, syncLeaseMs } from '../server/lib/sync-lease.ts'

const migrations = new URL('../server/databases/migrations/', import.meta.url)
const id = 'me'
const startHistoryId = async () => '100'

describe('sync lease on D1', () => {
  let mf: Miniflare
  let db: ReturnType<typeof drizzle>

  before(async () => {
    mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: ['DB'] })
    const d1 = await mf.getD1Database('DB')
    // Applies the same migration files as production, in order.
    for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
      for (const statement of readFileSync(new URL(file, migrations), 'utf8').split('--> statement-breakpoint')) {
        if (statement.trim()) await d1.prepare(statement).run()
      }
    }
    db = drizzle(d1)
  })

  after(() => mf.dispose())

  beforeEach(async () => {
    await db.delete(mailbox)
    await db.delete(syncRequests)
  })

  it('creates the mailbox at the start cursor on the first claim', async () => {
    const lease = await claimSync(db, id, startHistoryId)
    assert.ok(lease)
    const [row] = await db.select().from(mailbox)
    assert.equal(row?.historyId, '100')
    assert.equal(row?.syncLeaseUntil?.getTime(), lease.getTime())
  })

  it('lets only one sync hold the lease', async () => {
    const now = new Date()
    const leases = await Promise.all([1, 2, 3].map(() => claimSync(db, id, startHistoryId, now)))
    assert.equal(leases.filter(Boolean).length, 1)
    assert.equal(await claimSync(db, id, startHistoryId), undefined)
  })

  it('allows a new claim after release', async () => {
    const lease = await claimSync(db, id, startHistoryId)
    assert.ok(lease)
    await releaseSync(db, id, lease)
    assert.ok(await claimSync(db, id, startHistoryId))
  })

  it('takes over an expired lease, and the old holder cannot release it', async () => {
    const start = new Date()
    const stale = await claimSync(db, id, startHistoryId, start)
    assert.ok(stale)
    const later = new Date(start.getTime() + syncLeaseMs + 1)
    const current = await claimSync(db, id, startHistoryId, later)
    assert.ok(current)
    await releaseSync(db, id, stale)
    assert.equal(await claimSync(db, id, startHistoryId, later), undefined)
  })

  it('reports push requests that arrived after a sync started', async () => {
    const startedAt = new Date()
    assert.equal(await requestedSince(db, id, startedAt), false)
    await db.insert(syncRequests).values({ id, requestedAt: new Date(startedAt.getTime() - 1) })
    assert.equal(await requestedSince(db, id, startedAt), false)
    await db.update(syncRequests).set({ requestedAt: new Date(startedAt.getTime() + 1) })
    assert.equal(await requestedSince(db, id, startedAt), true)
  })
})
