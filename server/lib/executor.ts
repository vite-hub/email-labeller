/** Shared by the Worker and label setup CLI. Gmail credentials remain in Executor's org-owned Gmail account. */
export interface ExecutorConfig {
  url: string
  apiKey: string
  /** The Executor v2 Gmail account ID (`acc_…`) the calls run as. */
  account: string
  accessClientId?: string
  accessClientSecret?: string
}

const protocolVersion = '2025-11-25'

interface ExecuteResult {
  status: string
  requestId?: string
  message?: string
  execution?: { ok: boolean, value?: unknown, error?: { message?: string } }
}

interface ToolResult {
  content?: { type: string, text?: string }[]
  isError?: boolean
}

/**
 * Runs `body` as an Executor v2 `execute` program through the MCP endpoint, with `gmail` bound to
 * the Gmail app's `users` tools and `call(tool, { path, query, body })` running one of them as `config.account`.
 * A call that needs approval is approved only when `write` is set; otherwise the program is cancelled.
 */
export async function execute<T>(config: ExecutorConfig, body: string, input: unknown, options: { write?: boolean } = {}): Promise<T> {
  if (!config.apiKey) throw new Error('EXECUTOR_API_KEY is required')
  if (!config.account) throw new Error('EXECUTOR_GMAIL_ACCOUNT is required')
  if (!!config.accessClientId !== !!config.accessClientSecret) throw new Error('Both Cloudflare Access token values are required')
  const code = `
const gmail = tools.gmail.gmail.users
const accountId = ${JSON.stringify(config.account)}
const input = ${JSON.stringify(input)}
// Gmail's own HTTP status, which Executor reports inside its ToolCallFailed message.
function toolError(error) {
  let reported
  try { reported = JSON.parse(error.message) } catch {}
  const message = String(reported?.message ?? error.message)
  const status = Number(/responded with HTTP (\\d{3})/.exec(message)?.[1] ?? reported?.status ?? 0) || null
  return Object.assign(new Error(message), { code: reported?.code ?? null, status })
}
async function call(tool, request = {}) {
  try {
    return await tool({ accountId, input: request })
  } catch (error) {
    throw toolError(error)
  }
}
// Return only JSON values, including in nested arrays and objects.
const json = value => JSON.parse(JSON.stringify(value ?? null))
try {
  return json({ ok: true, value: await (async () => { ${body} })() })
} catch (error) {
  return json({ ok: false, message: String(error.message), code: error.code ?? null, status: error.status ?? null })
}`
  const session = await openSession(config)
  let outcome = await callTool(config, session, 'execute', { code })
  while (outcome.status === 'approval-required' || outcome.status === 'input-required') {
    if (!outcome.requestId) throw new Error(`Executor paused without a requestId: ${outcome.message ?? outcome.status}`)
    const approve = options.write === true && outcome.status === 'approval-required'
    const response = approve ? { action: 'accept', content: {} } : { action: 'cancel' }
    outcome = await callTool(config, session, 'resume', { requestId: outcome.requestId, response })
    if (!approve) throw new Error(`Executor asked to approve a call in a read-only run: ${outcome.message ?? 'cancelled'}`)
  }
  if (outcome.status !== 'completed' || !outcome.execution) {
    throw new Error(`Executor run did not complete: ${outcome.message ?? outcome.status}`)
  }
  if (!outcome.execution.ok) throw new Error(`Executor run failed: ${outcome.execution.error?.message ?? 'unknown error'}`)
  const result = outcome.execution.value as
    | { ok: true, value: T }
    | { ok: false, message: string, code: string | null, status: number | null }
    | undefined
  if (!result || typeof result.ok !== 'boolean') throw new Error('Executor run returned no result')
  if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code, status: result.status })
  return result.value
}

function headers(config: ExecutorConfig, session?: string): Record<string, string> {
  return {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
    'mcp-protocol-version': protocolVersion,
    ...session ? { 'mcp-session-id': session } : {},
    ...config.accessClientId && config.accessClientSecret ? {
      'cf-access-client-id': config.accessClientId,
      'cf-access-client-secret': config.accessClientSecret,
    } : {},
  }
}

async function post(config: ExecutorConfig, session: string | undefined, message: object): Promise<Response> {
  const response = await fetch(new URL('/mcp', config.url), {
    method: 'POST',
    headers: headers(config, session),
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`Executor responded with HTTP ${response.status}`)
  return response
}

/** Reads the JSON-RPC response with `id`, from a JSON body or an SSE stream. */
async function reply(response: Response, id: number): Promise<{ result?: unknown, error?: { message: string } }> {
  const text = await response.text()
  const messages = (response.headers.get('content-type') ?? '').startsWith('text/event-stream')
    ? text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean).map(data => JSON.parse(data))
    : [JSON.parse(text)]
  const message = messages.find(candidate => candidate.id === id)
  if (!message) throw new Error('Executor sent no MCP response')
  return message
}

async function openSession(config: ExecutorConfig): Promise<string> {
  const response = await post(config, undefined, {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'email-labeller', version: '1' } },
  })
  const session = response.headers.get('mcp-session-id')
  const initialized = await reply(response, 0)
  if (initialized.error || !session) throw new Error(`Executor MCP initialize failed: ${initialized.error?.message ?? 'no session'}`)
  await (await post(config, session, { jsonrpc: '2.0', method: 'notifications/initialized' })).body?.cancel()
  return session
}

let nextId = 1

async function callTool(config: ExecutorConfig, session: string, name: string, args: object): Promise<ExecuteResult> {
  const id = nextId++
  const message = await reply(await post(config, session, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }), id)
  if (message.error) throw new Error(`Executor ${name} failed: ${message.error.message}`)
  const result = message.result as ToolResult
  const text = result.content?.find(part => part.type === 'text')?.text
  if (!text) throw new Error(`Executor ${name} returned no text`)
  if (result.isError) throw new Error(`Executor ${name} failed: ${text.slice(0, 500)}`)
  return JSON.parse(text) as ExecuteResult
}
