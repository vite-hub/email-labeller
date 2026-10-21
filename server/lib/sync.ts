import { useServerEnv } from '#vitehub/env/server'
import { runAgent } from 'vite-hub/agent'
import { kv } from 'vite-hub/kv'
import labeller from '../agents/labeller'
import * as gmail from './gmail'
import { type Email, jevLabels } from './labeller'

const historyKey = 'gmail:history'
const watchExpiryKey = 'gmail:watch-expiry'
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
  // The prompt names local Console sessions; the rules and Jev read `data`.
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

/** Options for processing existing messages after changing the configuration. */
export interface ProcessOptions {
  /** Replace the other managed labels with the new decision's labels. */
  relabel?: boolean
}

export interface ProcessResult {
  decisions: Decision[]
  /** Messages that could not be fetched or decided. The other messages were still applied. */
  failed: gmail.MessageFailure[]
}

/** Returns the message of an error and of each error in its `cause` chain. */
export function describeError(error: unknown): string {
  const parts: string[] = []
  for (let current = error, depth = 0; current !== undefined && depth < 5; depth++) {
    if (!(current instanceof Error)) {
      parts.push(String(current))
      break
    }
    const status = (current as { status?: unknown }).status
    parts.push(typeof status === 'number' ? `${current.message} (${status})` : current.message)
    current = current.cause
  }
  return parts.join(': ')
}

/** Decides each message and applies changes in live mode. Decisions are not stored. */
export async function processMessages(ids: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  if (!ids.length) return { decisions: [], failed: [] }
  const config = useServerEnv().labeller
  const decided: Decision[] = []
  const failed: gmail.MessageFailure[] = []
  const labels = await gmail.listLabels()
  const uniqueIds = [...new Set(ids)]

  for (let start = 0; start < uniqueIds.length; start += batchSize) {
    const fetched = await gmail.getEmails(uniqueIds.slice(start, start + batchSize), labels)
    failed.push(...fetched.failed)
    const decisions: Decision[] = []
    const results = await Promise.allSettled(fetched.emails.map(decide))
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') decisions.push(result.value)
      else failed.push({ messageId: fetched.emails[index]!.id, error: describeError(result.reason) })
    })
    if (options.relabel) {
      for (const decision of decisions) {
        decision.remove = [...new Set([...decision.remove, ...Object.keys(config.labels).filter(name => !decision.add.includes(name))])]
      }
    }
    if (!config.dryRun && decisions.length) {
      const ids = await labelIds(decisions.flatMap(decision => decision.add), labels)
      await gmail.applyChanges(decisions.map(decision => ({
        id: decision.messageId,
        addLabelIds: decision.add.map(name => ids.get(name)!),
        removeLabelIds: decision.remove.flatMap(name => ids.has(name) ? [ids.get(name)!] : []),
        trash: decision.trash,
      })))
    }
    decided.push(...decisions)
  }
  return { decisions: decided, failed }
}

interface HistoryState {
  historyId: string
  syncedAt: number
}

/** Sync health. Written only when it changes, to keep KV writes low. */
interface SyncStatus {
  /** Start of the current failure streak. Absent after a successful sync. */
  failingSince?: number
  failures?: number
  error?: string
  /** Failed attempts per message that is still retried. */
  attempts?: Record<string, number>
  /** Messages skipped after `maxAttempts`, newest first. Process them with backfill. */
  skipped?: (gmail.MessageFailure & { at: number })[]
}

const statusKey = 'gmail:sync-status'
/** Sync attempts before a failing message is skipped, so it cannot block later mail. */
const maxAttempts = 3
const maxSkipped = 20
/** Consecutive failed syncs before health reports `failing`. One transient failure is normal. */
const failingAfter = 2
/** Time one sync call may spend on a backlog. The next cron, push, or call continues it. */
const syncBudget = 120_000

async function readStatus(): Promise<SyncStatus> {
  const [error, status] = await kv.get<SyncStatus>(statusKey)
  if (error) throw error
  return status ?? {}
}

async function writeStatus(status: SyncStatus): Promise<void> {
  const [error] = await kv.set(statusKey, status)
  if (error) throw error
}

/**
 * Counts attempts for failed messages. Throws while one may still succeed, so the cursor stays.
 * Messages at `maxAttempts` are skipped and the cursor moves past them.
 */
async function holdOrSkip(failed: gmail.MessageFailure[]): Promise<gmail.MessageFailure[]> {
  if (!failed.length) return []
  const status = await readStatus()
  const attempts = { ...status.attempts }
  for (const { messageId } of failed) attempts[messageId] = (attempts[messageId] ?? 0) + 1
  const retrying = failed.filter(({ messageId }) => attempts[messageId]! < maxAttempts)
  if (retrying.length) {
    await writeStatus({ ...status, attempts })
    throw new Error(`${retrying.length} message(s) failed and will be retried. ${retrying.map(({ messageId, error }) => `${messageId}: ${error}`).join('; ')}`)
  }
  for (const { messageId } of failed) delete attempts[messageId]
  const at = Date.now()
  const skipped = [...failed.map(failure => ({ ...failure, at })), ...status.skipped ?? []].slice(0, maxSkipped)
  await writeStatus({ ...status, attempts, skipped })
  console.warn(`[labeller] skipped ${failed.length} message(s) after ${maxAttempts} attempts`, failed)
  return failed
}

interface SyncStep extends ProcessResult {
  /** Gmail has more history after this step. */
  more: boolean
}

async function syncOnce(): Promise<SyncStep> {
  const [readError, history] = await kv.get<HistoryState>(historyKey)
  if (readError) throw readError
  const syncedAt = Date.now()
  if (!history) {
    // Start with future messages. Existing mail can be processed through backfill.
    const historyId = await gmail.currentHistoryId()
    const [writeError] = await kv.set(historyKey, { historyId, syncedAt })
    if (writeError) throw writeError
    return { decisions: [], failed: [], more: false }
  }

  const changes = await gmail.listNewMessageIds(history.historyId)
  let historyId: string
  let ids: string[]
  let more = false
  if (changes === 'expired') {
    historyId = await gmail.currentHistoryId()
    const query = `in:inbox after:${Math.max(0, Math.floor(history.syncedAt / 1000) - 1)}`
    ids = []
    let pageToken: string | undefined
    // Collect all pages before writes; archiving can change the search results.
    do {
      const page = await gmail.searchMessagePage(query, 500, pageToken)
      ids.push(...page.ids)
      pageToken = page.nextPageToken
    } while (pageToken)
  }
  else {
    ({ historyId, ids, more } = changes)
  }

  const { decisions, failed } = await processMessages(ids)
  // Failures leave the cursor in place. Retrying can repeat model calls and Gmail actions.
  const skipped = await holdOrSkip(failed)
  // Avoid a KV write when Gmail's cursor has not moved.
  if (historyId !== history.historyId) {
    const [writeError] = await kv.set(historyKey, { historyId, syncedAt })
    if (writeError) throw writeError
  }
  return { decisions, failed: skipped, more }
}

async function recordResult(error?: unknown): Promise<void> {
  const status = await readStatus()
  if (error === undefined) {
    if (status.failingSince === undefined && !Object.keys(status.attempts ?? {}).length) return
    const { failingSince: _since, failures: _failures, error: _error, attempts: _attempts, ...rest } = status
    return writeStatus(rest)
  }
  await writeStatus({
    ...status,
    failingSince: status.failingSince ?? Date.now(),
    failures: (status.failures ?? 0) + 1,
    error: describeError(error),
  })
}

export interface SyncResult extends ProcessResult {
  /** The time budget ended before the backlog. Call sync again to continue. */
  more: boolean
}

let running: Promise<SyncResult> | undefined
let queued = false

/** Coalesces sync calls in this isolate. Other Worker isolates can still overlap. */
export function sync(): Promise<SyncResult> {
  if (running) {
    queued = true
    return running
  }
  running = (async () => {
    const started = Date.now()
    const result: SyncResult = { decisions: [], failed: [], more: false }
    try {
      do {
        queued = false
        const step = await syncOnce()
        result.decisions.push(...step.decisions)
        result.failed.push(...step.failed)
        result.more = step.more
      } while ((queued || result.more) && Date.now() - started < syncBudget)
    }
    catch (error) {
      await recordResult(error).catch(recordError => console.error('[labeller] could not record the sync failure', recordError))
      throw error
    }
    finally {
      running = undefined
    }
    await recordResult()
    return result
  })()
  return running
}

export interface SyncHealth {
  status: 'ok' | 'failing'
  /** Last sync that moved the Gmail history cursor. */
  syncedAt?: string
  failingSince?: string
  failures?: number
  error?: string
  skipped?: SyncStatus['skipped']
}

/** Sync state for `/api/health`. Pass `details` only to admins: errors name message IDs. */
export async function syncHealth(details: boolean): Promise<SyncHealth> {
  const [historyError, history] = await kv.get<HistoryState>(historyKey)
  if (historyError) throw historyError
  const status = await readStatus()
  const iso = (time?: number) => time === undefined ? undefined : new Date(time).toISOString()
  return {
    status: (status.failures ?? 0) >= failingAfter ? 'failing' : 'ok',
    syncedAt: iso(history?.syncedAt),
    failingSince: iso(status.failingSince),
    failures: status.failures,
    ...details && { error: status.error, skipped: status.skipped },
  }
}

const watchRenewalMargin = 24 * 60 * 60 * 1000

/** Starts or renews the Gmail push watch when it expires within a day. */
export async function renewWatch(): Promise<boolean> {
  const { topic, audience, serviceAccount, subscription } = useServerEnv().pubsub
  // Do not start a Gmail watch unless the push endpoint can authenticate and
  // validate the notification. With only a topic configured, Gmail would send
  // notifications that the worker must reject, while polling would still work.
  if (!topic || !audience || !serviceAccount || !subscription) return false
  // Capture the cursor before starting Gmail's watch. A message received between
  // those two operations must remain after the cursor so the first sync can see it.
  const [historyError, history] = await kv.get<HistoryState>(historyKey)
  if (historyError) throw historyError
  if (!history) {
    const syncedAt = Date.now()
    const historyId = await gmail.currentHistoryId()
    const [writeError] = await kv.set(historyKey, { historyId, syncedAt })
    if (writeError) throw writeError
  }
  const [readError, expiresAt] = await kv.get<number>(watchExpiryKey)
  if (readError) throw readError
  if (expiresAt && expiresAt - Date.now() > watchRenewalMargin) return true
  const { expiration } = await gmail.watch(topic)
  // Separate keys keep watch renewal from overwriting a sync cursor.
  const [writeError] = await kv.set(watchExpiryKey, Number(expiration))
  if (writeError) throw writeError
  return true
}
