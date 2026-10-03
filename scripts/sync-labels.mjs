import labellerConfig from '../labeller.config.ts'

const apply = process.argv.includes('--apply')
const apiKey = process.env.EXECUTOR_API_KEY
const connection = process.env.EXECUTOR_GMAIL_CONNECTION || 'personalGmail'
const executorUrl = process.env.EXECUTOR_LOCAL_URL || 'http://127.0.0.1:4788'
if (!apiKey) throw new Error('EXECUTOR_API_KEY is required')

const code = `
const gmail = tools.gmail.user[${JSON.stringify(connection)}].gmail.users
const desired = ${JSON.stringify(labellerConfig.labels)}
const apply = ${JSON.stringify(apply)}
async function call(promise) {
  const result = await promise
  if (result.ok) return result.data
  throw new Error(result.error.message)
}
const current = (await call(gmail.labels.list({ userId: 'me' }))).labels.filter(label => label.type === 'user')
const details = await Promise.all(current.map(label => call(gmail.labels.get({ userId: 'me', id: label.id }))))
const byName = new Map(details.map(label => [label.name, label]))
const changes = { create: [], update: [], hide: [] }
for (const [name, settings] of Object.entries(desired)) {
  const label = byName.get(name)
  if (!label) {
    changes.create.push(name)
    if (apply) await call(gmail.labels.create({ userId: 'me', body: {
      name, color: settings.color, labelListVisibility: 'labelShow', messageListVisibility: 'show',
    } }))
    continue
  }
  const colorChanged = label.color?.textColor !== settings.color.textColor
    || label.color?.backgroundColor !== settings.color.backgroundColor
  const visibilityChanged = label.labelListVisibility !== 'labelShow' || label.messageListVisibility !== 'show'
  if (colorChanged || visibilityChanged) {
    changes.update.push(name)
    if (apply) await call(gmail.labels.patch({ userId: 'me', id: label.id, body: {
      color: settings.color, labelListVisibility: 'labelShow', messageListVisibility: 'show',
    } }))
  }
}
for (const label of details) {
  if (Object.hasOwn(desired, label.name)) continue
  // Hiding a label leaves it attached to existing messages and searchable by name.
  if (label.labelListVisibility === 'labelHide') continue
  changes.hide.push(label.name)
  if (apply) await call(gmail.labels.patch({ userId: 'me', id: label.id, body: {
    labelListVisibility: 'labelHide',
  } }))
}
return changes`

const response = await fetch(new URL('/api/executions', executorUrl), {
  method: 'POST',
  headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ code, autoApprove: apply }),
})
const execution = await response.json()
if (!response.ok || execution.status !== 'completed' || !execution.structured?.result) {
  throw new Error(`Executor label sync failed (HTTP ${response.status}): ${execution.structured?.error ?? execution.status}`)
}
console.log(JSON.stringify({ applied: apply, ...execution.structured.result }, null, 2))
