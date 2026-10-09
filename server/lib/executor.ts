/** Shared by the Worker and label setup CLI. Gmail credentials remain in Executor's org-owned connection. */
export interface ExecutorConfig {
  url: string
  apiKey: string
  connection: string
  accessClientId?: string
  accessClientSecret?: string
}

interface ExecutionResponse {
  status: string
  structured?: { result?: unknown, error?: string }
}

export async function execute<T>(config: ExecutorConfig, body: string, input: unknown, options: { write?: boolean } = {}): Promise<T> {
  if (!config.apiKey) throw new Error('EXECUTOR_API_KEY is required')
  if (!!config.accessClientId !== !!config.accessClientSecret) throw new Error('Both Cloudflare Access token values are required')
  const code = `
const gmail = tools.gmail.org[${JSON.stringify(config.connection)}].gmail.users
const input = ${JSON.stringify(input)}
async function call(promise) {
  const result = await promise
  if (result.ok) return result.data
  throw Object.assign(new Error(result.error.message), { code: result.error.code, status: result.error.status })
}
// Executor accepts only JSON values, including in nested arrays and objects.
const json = value => JSON.parse(JSON.stringify(value ?? null))
try {
  return json({ ok: true, value: await (async () => { ${body} })() })
} catch (error) {
  return json({ ok: false, message: String(error.message), code: error.code ?? null, status: error.status ?? null })
}`
  const response = await fetch(new URL('/api/executions', config.url), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      ...config.accessClientId && config.accessClientSecret ? {
        'cf-access-client-id': config.accessClientId,
        'cf-access-client-secret': config.accessClientSecret,
      } : {},
    },
    body: JSON.stringify({ code, autoApprove: options.write === true }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`Executor responded with HTTP ${response.status}`)
  const execution = await response.json() as ExecutionResponse
  const result = execution.structured?.result as
    | { ok: true, value: T }
    | { ok: false, message: string, code: string | null, status: number | null }
    | undefined
  if (execution.status !== 'completed' || !result || typeof result.ok !== 'boolean') {
    throw new Error(`Executor run did not complete: ${execution.structured?.error ?? execution.status}`)
  }
  if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code, status: result.status })
  return result.value
}
