import { useServerEnv } from '#vitehub/env/server'
import type { Email } from './labeller'

import { execute as runExecutor } from './executor'

type GmailError = Error & { code?: string, status?: number }

function execute<T>(body: string, input: unknown, options: { write?: boolean } = {}): Promise<T> {
  const { executor } = useServerEnv()
  return runExecutor<T>({
    url: executor.url,
    apiKey: executor.apiKey.unseal(),
    account: executor.account,
    accessClientId: executor.accessClientId?.unseal(),
    accessClientSecret: executor.accessClientSecret?.unseal(),
  }, body, input, options)
}

export interface Label {
  id: string
  name: string
  type: 'system' | 'user'
}

export async function listLabels(): Promise<Label[]> {
  return execute(`return (await call(gmail.labels.list, { path: { userId: 'me' } })).labels ?? []`, null)
}

export async function createLabel(name: string): Promise<Label> {
  return execute(`return call(gmail.labels.create, { path: { userId: 'me' }, body: { name: input } })`, name, { write: true })
}

export async function currentHistoryId(): Promise<string> {
  return execute(`return (await call(gmail.getProfile, { path: { userId: 'me' } })).historyId`, null)
}

/**
 * Returns Inbox messages added after `startHistoryId`, or `expired` when Gmail no longer has that history.
 * `more` is true when the read stopped at `maxEntries` and later history may remain.
 */
export async function listNewMessageIds(startHistoryId: string, maxEntries = 20): Promise<{ ids: string[], historyId: string, more: boolean } | 'expired'> {
  try {
    return await execute(`
const ids = new Set()
let pageToken
let historyId = input.startHistoryId
let entries = 0
do {
  const page = await call(gmail.history.list, {
    path: { userId: 'me' },
    query: { startHistoryId: input.startHistoryId, historyTypes: ['messageAdded'], labelId: 'INBOX', pageToken },
  })
  for (const entry of page.history ?? []) {
    for (const { message } of entry.messagesAdded ?? []) ids.add(message.id)
    historyId = entry.id ?? historyId
    entries++
    if (entries >= input.maxEntries) return { ids: [...ids], historyId, more: true }
  }
  historyId = page.historyId
  pageToken = page.nextPageToken
} while (pageToken)
return { ids: [...ids], historyId, more: false }`, { startHistoryId, maxEntries })
  }
  catch (error) {
    if ((error as GmailError).status === 404) return 'expired'
    throw error
  }
}

export async function searchMessageIds(query: string, max: number): Promise<string[]> {
  return (await searchMessagePage(query, max)).ids
}

/** One page of a Gmail search. Pass `nextPageToken` back to read the next page. */
export async function searchMessagePage(query: string, max: number, pageToken?: string): Promise<{ ids: string[], nextPageToken?: string }> {
  return execute(`
const page = await call(gmail.messages.list, { path: { userId: 'me' }, query: { q: input.query, maxResults: input.max, pageToken: input.pageToken } })
return { ids: (page.messages ?? []).map(message => message.id), nextPageToken: page.nextPageToken }`, { query, max, pageToken })
}

interface RawPart {
  mimeType: string
  data?: string
}

interface RawMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  headers: { name: string, value: string }[]
  parts: RawPart[]
}

const maxBodyLength = 4000
const maxCallsPerRun = 90

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8')
}

function toText(parts: RawPart[]): string {
  const plain = parts.find(part => part.mimeType === 'text/plain' && part.data)
  if (plain?.data) return decodeBase64Url(plain.data)
  const html = parts.find(part => part.mimeType === 'text/html' && part.data)
  if (!html?.data) return ''
  return decodeBase64Url(html.data)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** A message that could not be fetched or decided. Other messages in its batch continue. */
export interface MessageFailure {
  messageId: string
  error: string
}

/**
 * Fetches messages and resolves label IDs to names. Deleted messages are skipped.
 * A message that fails alone is returned in `failed`. Quota errors fail the whole call.
 */
export async function getEmails(ids: string[], labels: Label[]): Promise<{ emails: Email[], failed: MessageFailure[] }> {
  if (!ids.length) return { emails: [], failed: [] }
  const raw = await execute<(RawMessage | MessageFailure | null)[]>(`
function textParts(part, out = []) {
  if (part.mimeType?.startsWith('text/') && part.body?.data) out.push({ mimeType: part.mimeType, data: part.body.data })
  for (const child of part.parts ?? []) textParts(child, out)
  return out
}
async function get(id) {
  try {
    return await call(gmail.messages.get, { path: { userId: 'me', id }, query: { format: 'full' } })
  } catch (error) {
    // A result too large for Executor to return: label the message from its headers and snippet.
    if (!/output limit|too large/i.test(error.message)) throw error
    return call(gmail.messages.get, { path: { userId: 'me', id }, query: { format: 'metadata' } })
  }
}
return Promise.all(input.map(async (id) => {
  try {
    const message = await get(id)
    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds,
      snippet: message.snippet,
      headers: message.payload.headers ?? [],
      parts: textParts(message.payload),
    }
  } catch (error) {
    if (error.status === 404) return null
    // Quota errors affect every message. Retry the whole batch later.
    if (error.status === 403 || error.status === 429) throw error
    return { messageId: id, error: String(error.message) }
  }
}))`, ids)
  const names = new Map(labels.map(label => [label.id, label.name]))
  const emails: Email[] = []
  const failed: MessageFailure[] = []
  for (const message of raw) {
    if (message === null) continue
    if ('error' in message) {
      failed.push(message)
      continue
    }
    const headers = Object.fromEntries(message.headers.map(({ name, value }) => [name.toLowerCase(), value]))
    emails.push({
      id: message.id,
      threadId: message.threadId,
      from: headers.from ?? '',
      to: [headers.to, headers.cc, headers['delivered-to']].filter((value): value is string => !!value),
      subject: headers.subject ?? '',
      snippet: message.snippet ?? '',
      body: toText(message.parts).replace(/\s+/g, ' ').trim().slice(0, maxBodyLength),
      listId: headers['list-id'] ?? '',
      labels: (message.labelIds ?? []).map(id => names.get(id) ?? id),
      headers,
    })
  }
  return { emails, failed }
}

export interface Change {
  id: string
  addLabelIds: string[]
  removeLabelIds: string[]
  trash: boolean
}

export async function applyChanges(changes: Change[]): Promise<void> {
  if (!changes.length) return
  await execute(`
await Promise.all(input.map(async ({ id, addLabelIds, removeLabelIds, trash }) => {
  try {
    if (addLabelIds.length || removeLabelIds.length) {
      await call(gmail.messages.modify, { path: { userId: 'me', id }, body: { addLabelIds, removeLabelIds } })
    }
    if (trash) await call(gmail.messages.trash, { path: { userId: 'me', id } })
  } catch (error) {
    // A deleted message must not block the history cursor forever.
    if (error.status !== 404) throw error
  }
}))`, changes, { write: true })
}

/** Starts or renews Gmail push notifications for the Inbox. */
export async function watch(topicName: string): Promise<{ historyId: string, expiration: string }> {
  return execute(`
return call(gmail.watch, { path: { userId: 'me' }, body: { topicName: input, labelIds: ['INBOX'], labelFilterBehavior: 'include' } })`, topicName, { write: true })
}

/** Moves messages to Trash. Gmail deletes them after 30 days. */
export async function trashMessages(ids: string[]): Promise<void> {
  // One Executor program makes at most 100 tool calls.
  for (let start = 0; start < ids.length; start += maxCallsPerRun) {
    await execute(`
for (let start = 0; start < input.length; start += 10) {
  await Promise.all(input.slice(start, start + 10).map(id => call(gmail.messages.trash, { path: { userId: 'me', id } })))
}`, ids.slice(start, start + maxCallsPerRun), { write: true })
  }
}
