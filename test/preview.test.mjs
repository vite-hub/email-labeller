import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { resolve } from 'node:path'
import { after, before, test } from 'node:test'

const token = 'fixture-admin-token-with-32-characters'
const calls = []
const labels = [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system' }]
const fixtures = [
  ['bot', 'notifications@github.com', 'Re: issue', { 'X-GitHub-Sender': 'renovate[bot]' }],
  ['github', 'notifications@github.com', 'New issue', {}],
  ['published', 'support@npmjs.com', 'Successfully published package', {}],
  ['staged', 'support@npmjs.com', 'Successfully staged package', {}],
  ['promotions', 'offers@example.com', 'Offer', {}],
]
const messages = fixtures.map(([id, from, subject, headers]) => ({
  id, threadId: id, internalDate: '1793900000000', labelIds: id === 'promotions' ? ['INBOX', 'CATEGORY_PROMOTIONS'] : ['INBOX'],
  snippet: 'Fixture email', payload: { mimeType: 'text/plain', body: { data: Buffer.from('Fixture email').toString('base64url') },
    headers: Object.entries({ From: from, Subject: subject, ...headers }).map(([name, value]) => ({ name, value })) },
}))
const tool = (name, handler) => async ({ accountId, input }) => {
  assert.equal(accountId, 'acc_fixture')
  calls.push(name)
  checkQuery(input.query)
  return handler(input)
}
// Executor validates Gmail query params against the tool schema: repeated params are arrays, flags are booleans.
const checkQuery = (query = {}) => {
  for (const key of ['historyTypes', 'labelIds', 'metadataHeaders']) if (key in query) assert.ok(Array.isArray(query[key]), `${key} must be an array`)
  if ('includeSpamTrash' in query) assert.equal(typeof query.includeSpamTrash, 'boolean')
}
const forbidden = name => tool(name, () => { throw new Error(`Unexpected Gmail mutation: ${name}`) })
const tools = { gmail: { gmail: { users: {
  getProfile: tool('profile.get', () => ({ emailAddress: 'fixture@example.com', historyId: '1' })),
  history: { list: tool('history.list', () => ({ historyId: '2', history: [] })) },
  labels: { list: tool('labels.list', () => ({ labels })), get: tool('labels.get', ({ path }) => labels.find(label => label.id === path.id)),
    create: forbidden('labels.create'), patch: forbidden('labels.patch') },
  messages: {
    list: tool('messages.list', () => ({ messages: messages.map(({ id }) => ({ id })) })),
    get: tool('messages.get', ({ path }) => messages.find(message => message.id === path.id)),
    modify: forbidden('messages.modify'), trash: forbidden('messages.trash'),
  },
} } } }
let worker, server, directory, base, logs = ''

before(async () => {
  server = createServer(async (request, response) => {
    try {
      let body = ''
      for await (const chunk of request) body += chunk
      const rpc = JSON.parse(body)
      let result = {}
      if (rpc.method === 'initialize') response.setHeader('mcp-session-id', 'fixture-session')
      if (rpc.method === 'tools/call') {
        assert.equal(rpc.params.name, 'execute')
        const run = new Function('tools', `return (async () => {${rpc.params.arguments.code}})()`)
        result = { content: [{ type: 'text', text: JSON.stringify({ status: 'completed', execution: { ok: true, value: await run(tools) } }) }] }
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
    } catch (error) { response.writeHead(500).end(String(error)) }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  directory = await mkdtemp(resolve('.wrangler/preview-test-'))
  const output = resolve(process.env.LABELLER_TEST_OUTPUT || '.output/server')
  const config = JSON.parse(await readFile(resolve(output, 'wrangler.json'), 'utf8'))
  config.main = resolve(output, config.main)
  if (config.assets) config.assets.directory = resolve(output, config.assets.directory)
  delete config.routes
  delete config.account_id
  config.vars = { EXECUTOR_URL: `http://127.0.0.1:${server.address().port}`, EXECUTOR_GMAIL_ACCOUNT: 'acc_fixture',
    LABELLER_DRY_RUN: 'false', LABELLER_TRASH_ENABLED: 'true', LABELLER_CLEANUP_ENABLED: 'false' }
  await writeFile(resolve(directory, 'wrangler.json'), JSON.stringify(config))
  await writeFile(resolve(directory, '.dev.vars'), `EXECUTOR_API_KEY=fixture\nVITEHUB_SECRET=${token}\n`, { mode: 0o600 })
  // Wrangler needs a fixed free port; the fixture owns and releases the probe first.
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  base = `http://127.0.0.1:${port}`
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', resolve(directory, 'wrangler.json'),
    '--ip', '127.0.0.1', '--port', String(port), '--persist-to', resolve(directory, 'state')], { stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => { logs += chunk })
  const deadline = Date.now() + 30_000
  while (true) {
    if (worker.exitCode !== null) throw new Error(logs)
    const ready = await new Promise(resolve => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.on('connect', () => { socket.destroy(); resolve(true) })
      socket.on('error', () => resolve(false))
    })
    if (ready) break
    if (Date.now() > deadline) throw new Error(logs)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
})

after(async () => {
  if (worker && worker.exitCode === null) { worker.kill('SIGTERM'); await once(worker, 'exit') }
  if (server) await new Promise(resolve => server.close(resolve))
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(response.status, 200, logs)
  return response.json()
}

test('preview uses ordered rules through Executor v2 without Gmail writes in live mode', async () => {
  const preview = await api('preview', { max: 5 })
  assert.equal(preview.failed, 0)
  assert.equal(preview.processed, 5)
  assert.deepEqual(preview.decisions.map(({ messageId, result }) => [messageId, result.label]), [
    ['bot', 'GitHub/Bots'], ['github', 'GitHub'], ['published', 'Dev Services'], ['staged', 'Dev Services'], ['promotions', 'Promotions'],
  ])
  assert.ok(calls.includes('messages.get'))
  assert.equal(calls.some(name => /modify|trash|create|patch/.test(name)), false)
})

test('disabled cleanup returns the upstream preview without trashing messages', async () => {
  const { cleanup } = await api('cleanup', {})
  assert.equal(cleanup.applied, false)
  assert.deepEqual(cleanup.rules.map(({ rule, query }) => [rule, query]), [
    ['promotions', 'label:"Promotions" older_than:14d -is:starred -in:trash'],
    ['security', 'label:"Security" older_than:30d -is:starred -in:trash'],
  ])
  assert.equal(calls.includes('messages.trash'), false)
})

test('health reads Channel state and keeps errors and message IDs private', async () => {
  assert.equal((await api('sync', {})).synced, true)
  assert.equal((await api('sync', {})).synced, true)
  assert.ok(calls.includes('history.list'))
  const publicResponse = await fetch(`${base}/api/health`)
  assert.equal(publicResponse.status, 200, logs)
  const health = await publicResponse.json()
  assert.equal(health.status, 'ok')
  assert.equal('skipped' in health, false)
  const admin = await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(admin.status, 200, logs)
  assert.deepEqual((await admin.json()).skipped, [])
})
