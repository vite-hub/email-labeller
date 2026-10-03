import { eq, inArray } from 'drizzle-orm'
import { useServerEnv } from '#vitehub/env/server'
import { runAgent } from 'vite-hub/agent'
import { useDatabase } from 'vite-hub/database/drizzle'
import labeller from '../agents/labeller'
import * as gmail from './gmail'
import { type Email, jevLabels } from './labeller'
import { claimSync, releaseSync, requestedSince } from './sync-lease'

const mailboxId = 'me'
const batchSize = 20

export interface Decision {
  messageId: string
  from: string
  subject: string
  source: 'rule' | 'jev'
  rule?: string
  jevChoice?: string
  jevProbability?: number
  add: string[]
  remove: string[]
  trash: boolean
}

/** Runs the labeller Agent for one email. */
export async function decide(email: Email): Promise<Decision> {
  // The prompt names the Console session; the rules and Jev read `data`.
  const [error, output] = await runAgent(labeller, { data: email, prompt: `${email.from}: ${email.subject}` })
  if (error) throw error
  if (output instanceof Response) throw new Error('The labeller Agent returned an HTTP response')
  const config = useServerEnv().labeller
  const base = { messageId: email.id, from: email.from, subject: email.subject }
  if ('rule' in output) return { ...base, source: 'rule', ...output, trash: output.trash && config.trashEnabled }

  // `runAgent` also types a workflow run, which this Agent never starts.
  if (!('label' in output)) throw new Error('The labeller Agent returned no label decision')
  const { label } = output
  const probability = label.probabilities[label.choice] ?? 0
  const allowed = Object.hasOwn(jevLabels(config.labels), label.choice)
  const confident = allowed && Number.isFinite(probability) && probability >= 0 && probability <= 1
    && probability >= config.minConfidence
  return {
    ...base,
    source: 'jev',
    jevChoice: label.choice,
    jevProbability: probability,
    add: confident ? [label.choice] : [],
    remove: [],
    trash: false,
  }
}

/** Resolves label names to IDs and creates missing user labels. */
async function labelIds(names: string[], labels: gmail.Label[]): Promise<Map<string, string>> {
  const ids = new Map(labels.map(label => [label.name, label.id]))
  for (const name of new Set(names)) {
    if (ids.has(name)) continue
    let created: gmail.Label
    try {
      created = await gmail.createLabel(name)
    }
    catch (error) {
      if ((error as { status?: number }).status !== 409) throw error
      const existing = (await gmail.listLabels()).find(label => label.name === name)
      if (!existing) throw error
      created = existing
    }
    labels.push(created)
    ids.set(name, created.id)
  }
  return ids
}

/** Decides, applies, and records new messages. Already recorded messages are skipped. */
export interface ProcessOptions {
  /**
   * Decide messages again even when they have a decision, and remove the other labels from `labels` in
   * `labeller.config.ts`. Use it after changing labels or rules.
   */
  relabel?: boolean
}

export async function processMessages(ids: string[], options: ProcessOptions = {}): Promise<Decision[]> {
  const { db, schema } = useDatabase('default')
  const config = useServerEnv().labeller
  const dryRun = config.dryRun
  const decided: Decision[] = []
  const labels = await gmail.listLabels()
  const managed = new Map(labels.filter(label => Object.hasOwn(config.labels, label.name)).map(label => [label.name, label.id]))

  for (let start = 0; start < ids.length; start += batchSize) {
    const batch = ids.slice(start, start + batchSize)
    const done = options.relabel
      ? new Set<string>()
      : new Set((await db.select({ id: schema.decisions.messageId, dryRun: schema.decisions.dryRun }).from(schema.decisions)
          .where(inArray(schema.decisions.messageId, batch)))
          .filter(row => dryRun || !row.dryRun)
          .map(row => row.id))
    const emails = await gmail.getEmails(batch.filter(id => !done.has(id)), labels)
    const decisions = await Promise.all(emails.map(decide))

    if (!dryRun) {
      const ids = await labelIds(decisions.flatMap(decision => decision.add), labels)
      await gmail.applyChanges(decisions.map(decision => ({
        id: decision.messageId,
        addLabelIds: decision.add.map(name => ids.get(name) ?? name),
        removeLabelIds: options.relabel
          ? [...decision.remove, ...[...managed].filter(([name]) => !decision.add.includes(name)).map(([, id]) => id)]
          : decision.remove,
        trash: decision.trash,
      })))
    }
    if (decisions.length) {
      for (const decision of decisions) {
        const record = {
          messageId: decision.messageId,
          from: decision.from,
          subject: decision.subject,
          source: decision.source,
          rule: decision.rule,
          jevChoice: decision.jevChoice,
          jevProbability: decision.jevProbability,
          addLabels: decision.add,
          removeLabels: decision.remove,
          trash: decision.trash,
          dryRun,
          decidedAt: new Date(),
        }
        await db.insert(schema.decisions).values(record)
          .onConflictDoUpdate({ target: schema.decisions.messageId, set: record })
      }
    }
    decided.push(...decisions)
  }
  return decided
}

/** Persist the push request before acknowledging Pub/Sub. Cron can recover if inline sync fails. */
export async function recordSyncRequest(): Promise<void> {
  const { db, schema } = useDatabase('default')
  const record = { id: mailboxId, requestedAt: new Date() }
  await db.insert(schema.syncRequests).values(record)
    .onConflictDoUpdate({ target: schema.syncRequests.id, set: { requestedAt: record.requestedAt } })
}

async function syncOnce(): Promise<Decision[]> {
  const { db, schema } = useDatabase('default')
  const [mailbox] = await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, mailboxId))
  if (!mailbox) return []
  const changes = await gmail.listNewMessageIds(mailbox.historyId)
  if (changes === 'expired') {
    // Gmail keeps about a week of history. Recover recent Inbox mail, then continue from now.
    const historyId = await gmail.currentHistoryId()
    const decisions = await processMessages(await gmail.searchMessageIds('in:inbox newer_than:2d', 100))
    await db.update(schema.mailbox).set({ historyId }).where(eq(schema.mailbox.id, mailboxId))
    return decisions
  }
  const decisions = changes.ids.length ? await processMessages(changes.ids) : []
  // Advance the cursor only after every message is recorded, so a failure retries the same history.
  await db.update(schema.mailbox).set({ historyId: changes.historyId }).where(eq(schema.mailbox.id, mailboxId))
  return decisions
}

let running: Promise<Decision[]> | undefined
let queued = false

/**
 * Processes new Inbox messages since the stored history cursor. Only one sync runs at a time across Worker isolates.
 * A sync that cannot claim the mailbox returns no decisions: the running sync checks for push notifications that
 * arrived while it ran, and syncs again for them. Calls in the same isolate during a sync also make it run again.
 */
export function sync(): Promise<Decision[]> {
  if (running) {
    queued = true
    return running
  }
  running = (async () => {
    const { db } = useDatabase('default')
    const decisions: Decision[] = []
    try {
      let again = true
      while (again) {
        queued = false
        const startedAt = new Date()
        const lease = await claimSync(db, mailboxId, gmail.currentHistoryId)
        if (!lease) break
        try {
          decisions.push(...await syncOnce())
        }
        finally {
          await releaseSync(db, mailboxId, lease)
        }
        // Check after the release: a push that failed to claim recorded its request before this point.
        again = queued || await requestedSince(db, mailboxId, startedAt)
      }
      return decisions
    }
    finally {
      running = undefined
    }
  })()
  return running
}

const watchRenewalMargin = 24 * 60 * 60 * 1000

/** Starts or renews the Gmail push watch when it expires within a day. */
export async function renewWatch(): Promise<boolean> {
  const topic = useServerEnv().pubsub.topic
  if (!topic) return false
  const { db, schema } = useDatabase('default')
  const [mailbox] = await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, mailboxId))
  if (mailbox?.watchExpiresAt && mailbox.watchExpiresAt.getTime() - Date.now() > watchRenewalMargin) return true
  const { historyId, expiration } = await gmail.watch(topic)
  const watchExpiresAt = new Date(Number(expiration))
  await db.insert(schema.mailbox).values({ id: mailboxId, historyId, watchExpiresAt })
    .onConflictDoUpdate({ target: schema.mailbox.id, set: { watchExpiresAt } })
  return true
}
