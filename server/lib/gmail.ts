import { useServerEnv } from '#vitehub/env/server'
import type { Email } from './labeller'

// Gmail through Executor code mode. Executor keeps the Google OAuth credential in the org-owned `gmail` connection.
// On Executor's Cloudflare host, the Access service token is the caller's identity; each Access identity is a separate
// subject, so only org-owned connections are shared with this Worker. Each call sends one sandboxed script, so several
// Gmail requests share a single round trip. Results must be JSON: Executor rejects `undefined` values with HTTP 400.

interface ExecutionResponse {
  status: 'completed' | 'paused'
  structured?: { status: string, result?: unknown, error?: string }
}

type GmailError = Error & { code?: string, status?: number }

// Runs in the Executor sandbox. `call()` unwraps Executor's `{ ok, data }` tool result.
const prelude = (connection: string) => `
const gmail = tools.gmail.org[${JSON.stringify(connection)}].gmail.users
async function call(result) {
  const r = await result
  if (r.ok) return r.data
  const error = new Error(r.error.message)
  error.code = r.error.code
  error.status = r.error.status
  throw error
}
`

async function execute<T>(body: string, input: unknown, options: { write?: boolean } = {}): Promise<T> {
  const { executor } = useServerEnv()
  const code = `${prelude(executor.connection)}
const input = ${JSON.stringify(input)}
// Executor only returns JSON values: the round trip drops \`undefined\` properties, as JSON.stringify does.
const json = value => JSON.parse(JSON.stringify(value ?? null))
try {
  return json({ ok: true, value: await (async () => { ${body} })() })
} catch (error) {
  return json({ ok: false, message: String(error.message), code: error.code ?? null, status: error.status ?? null })
}`
  const response = await fetch(new URL('/api/executions', executor.url), {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${executor.apiKey.unseal()}`,
      'content-type': 'application/json',
      ...executor.accessClientId && executor.accessClientSecret
        ? {
            'cf-access-client-id': executor.accessClientId.unseal(),
            'cf-access-client-secret': executor.accessClientSecret.unseal(),
          }
        : {},
    },
    // Executor pauses write tools for approval unless the caller approves them up front.
    body: JSON.stringify({ code, autoApprove: options.write === true }),
  })
  if (!response.ok) throw new Error(`Executor responded with HTTP ${response.status}`)
  const execution = await response.json() as ExecutionResponse
  const result = execution.structured?.result as
    | { ok: true, value: T }
    | { ok: false, message: string, code: string | null, status: number | null }
    | undefined
  if (execution.status !== 'completed' || !result) {
    throw new Error(`Executor run did not complete: ${execution.structured?.error ?? execution.status}`)
  }
  if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code, status: result.status }) as GmailError
  return result.value
}

export interface Label {
  id: string
  name: string
  type: 'system' | 'user'
}

export async function listLabels(): Promise<Label[]> {
  return execute(`return (await call(gmail.labels.list({ userId: 'me' }))).labels ?? []`, null)
}

export async function createLabel(name: string): Promise<Label> {
  return execute(`return call(gmail.labels.create({ userId: 'me', body: { name: input } }))`, name, { write: true })
}

export async function currentHistoryId(): Promise<string> {
  return execute(`return (await call(gmail.getProfile({ userId: 'me' }))).historyId`, null)
}

/**
 * Returns Inbox messages added after `startHistoryId`, or `expired` when Gmail no longer has that history.
 */
export async function listNewMessageIds(startHistoryId: string): Promise<{ ids: string[], historyId: string } | 'expired'> {
  try {
    return await execute(`
const ids = new Set()
let pageToken
let historyId = input
do {
  const page = await call(gmail.history.list({
    userId: 'me', startHistoryId: input, historyTypes: ['messageAdded'], labelId: 'INBOX', pageToken,
  }))
  for (const entry of page.history ?? []) {
    for (const { message } of entry.messagesAdded ?? []) ids.add(message.id)
  }
  historyId = page.historyId
  pageToken = page.nextPageToken
} while (pageToken)
return { ids: [...ids], historyId }`, startHistoryId)
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
const page = await call(gmail.messages.list({ userId: 'me', q: input.query, maxResults: input.max, pageToken: input.pageToken }))
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

/** Fetches messages and resolves label IDs to names. Deleted messages are skipped. */
export async function getEmails(ids: string[], labels: Label[]): Promise<Email[]> {
  if (!ids.length) return []
  const raw = await execute<(RawMessage | null)[]>(`
function textParts(part, out = []) {
  if (part.mimeType?.startsWith('text/') && part.body?.data) out.push({ mimeType: part.mimeType, data: part.body.data })
  for (const child of part.parts ?? []) textParts(child, out)
  return out
}
return Promise.all(input.map(async (id) => {
  try {
    const message = await call(gmail.messages.get({ userId: 'me', id, format: 'full' }))
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
    throw error
  }
}))`, ids)
  const names = new Map(labels.map(label => [label.id, label.name]))
  return raw.filter(message => message !== null).map((message) => {
    const headers = Object.fromEntries(message.headers.map(({ name, value }) => [name.toLowerCase(), value]))
    return {
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
    }
  })
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
  if (addLabelIds.length || removeLabelIds.length) {
    await call(gmail.messages.modify({ userId: 'me', id, body: { addLabelIds, removeLabelIds } }))
  }
  if (trash) await call(gmail.messages.trash({ userId: 'me', id }))
}))`, changes, { write: true })
}

/** Starts or renews Gmail push notifications for the Inbox. */
export async function watch(topicName: string): Promise<{ historyId: string, expiration: string }> {
  return execute(`
return call(gmail.watch({ userId: 'me', body: { topicName: input, labelIds: ['INBOX'], labelFilterBehavior: 'include' } }))`, topicName, { write: true })
}

/** Moves messages to Trash. Gmail deletes them after 30 days. */
export async function trashMessages(ids: string[]): Promise<void> {
  if (!ids.length) return
  await execute(`
for (let start = 0; start < input.length; start += 10) {
  await Promise.all(input.slice(start, start + 10).map(id => call(gmail.messages.trash({ userId: 'me', id }))))
}`, ids, { write: true })
}
