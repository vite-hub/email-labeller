import { useServerEnv } from '#vitehub/env/server'
import type { GmailClient } from 'vite-hub/agent/channels'
import { execute } from './executor'

const arrayParams = new Set(['historyTypes', 'labelIds', 'metadataHeaders'])
const booleanParams = new Set(['includeSpamTrash'])

/** ViteHub sends REST query strings; Executor validates repeated params as arrays and flags as booleans. */
export function toToolQuery(query?: Record<string, unknown>) {
  if (!query) return query
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => {
    if (arrayParams.has(key) && !Array.isArray(value)) return [key, [value]]
    if (booleanParams.has(key) && typeof value === 'string') return [key, value === 'true']
    return [key, value]
  }))
}

/** Adapt ViteHub's REST requests to the Executor v2 Gmail tools. */
export const gmailClient: GmailClient = async (request) => {
  const { executor } = useServerEnv()
  return execute({
    url: executor.url,
    apiKey: executor.apiKey.unseal(),
    account: executor.account,
    accessClientId: executor.accessClientId?.unseal(),
    accessClientSecret: executor.accessClientSecret?.unseal(),
  }, `
const segments = input.path.split('/').map(decodeURIComponent)
const [resource, id, action] = segments
let tool
if (resource === 'profile') tool = gmail.getProfile
else if (resource === 'watch') tool = gmail.watch
else if (resource === 'history') tool = gmail.history.list
else if (resource === 'labels') {
  tool = id ? (input.method === 'GET' ? gmail.labels.get : gmail.labels.patch)
    : (input.method === 'GET' ? gmail.labels.list : gmail.labels.create)
}
else if (resource === 'messages') {
  tool = action === 'attachments' ? gmail.messages.attachments.get
    : action === 'modify' ? gmail.messages.modify
    : action === 'trash' ? gmail.messages.trash
    : id ? gmail.messages.get : gmail.messages.list
}
else if (resource === 'threads' && id) tool = gmail.threads.get
if (!tool) throw new Error('Unsupported Gmail request: ' + input.method + ' ' + input.path)
const request = {
  path: { userId: 'me', ...(id ? { id } : {}), ...(action === 'attachments' ? { messageId: id, id: segments[3] } : {}) },
  query: input.query,
  body: input.body,
}
try { return await call(tool, request) }
catch (error) {
  if (resource !== 'messages' || action || !id || !/output limit|too large/i.test(error.message)) throw error
  return call(gmail.messages.get, { ...request, query: { format: 'metadata' } })
}
`, { ...request, query: toToolQuery(request.query) }, { write: request.method !== 'GET' })
}
