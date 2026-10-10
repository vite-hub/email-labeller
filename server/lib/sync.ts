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

/** Decides each message and applies changes in live mode. Decisions are not stored. */
export async function processMessages(ids: string[], options: ProcessOptions = {}): Promise<Decision[]> {
  if (!ids.length) return []
  const config = useServerEnv().labeller
  const decided: Decision[] = []
  const labels = await gmail.listLabels()
  const uniqueIds = [...new Set(ids)]

  for (let start = 0; start < uniqueIds.length; start += batchSize) {
    const emails = await gmail.getEmails(uniqueIds.slice(start, start + batchSize), labels)
    const decisions = await Promise.all(emails.map(decide))
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
  return decided
}

interface HistoryState {
  historyId: string
  syncedAt: number
}

async function syncOnce(): Promise<Decision[]> {
  const [readError, history] = await kv.get<HistoryState>(historyKey)
  if (readError) throw readError
  const syncedAt = Date.now()
  if (!history) {
    // Start with future messages. Existing mail can be processed through backfill.
    const historyId = await gmail.currentHistoryId()
    const [writeError] = await kv.set(historyKey, { historyId, syncedAt })
    if (writeError) throw writeError
    return []
  }

  const changes = await gmail.listNewMessageIds(history.historyId)
  let historyId: string
  let ids: string[]
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
    historyId = changes.historyId
    ids = changes.ids
  }

  const decisions = await processMessages(ids)
  // Failures leave the cursor in place. Retrying can repeat model calls and Gmail actions.
  // Avoid a KV write when Gmail's cursor has not moved.
  if (historyId !== history.historyId) {
    const [writeError] = await kv.set(historyKey, { historyId, syncedAt })
    if (writeError) throw writeError
  }
  return decisions
}

let running: Promise<Decision[]> | undefined
let queued = false

/** Coalesces sync calls in this isolate. Other Worker isolates can still overlap. */
export function sync(): Promise<Decision[]> {
  if (running) {
    queued = true
    return running
  }
  running = (async () => {
    const decisions: Decision[] = []
    try {
      do {
        queued = false
        decisions.push(...await syncOnce())
      } while (queued)
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
