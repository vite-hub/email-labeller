import labellerConfig from '../labeller.config.ts'
import { execute } from '../server/lib/executor.ts'

const apply = process.argv.includes('--apply')
const hideUnmanaged = process.argv.includes('--hide-unmanaged')

const body = `
const desired = input.labels
const apply = input.apply
const current = ((await call(gmail.labels.list({ userId: 'me' }))).labels ?? []).filter(label => label.type === 'user')
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
  if (!input.hideUnmanaged || Object.hasOwn(desired, label.name)) continue
  // Hiding a label leaves it attached to existing messages and searchable by name.
  if (label.labelListVisibility === 'labelHide') continue
  changes.hide.push(label.name)
  if (apply) await call(gmail.labels.patch({ userId: 'me', id: label.id, body: {
    labelListVisibility: 'labelHide',
  } }))
}
return changes`

const changes = await execute({
  url: process.env.EXECUTOR_URL || 'https://executor.onmax.me',
  apiKey: process.env.EXECUTOR_API_KEY,
  connection: process.env.EXECUTOR_GMAIL_CONNECTION || 'gmail',
  accessClientId: process.env.CF_ACCESS_CLIENT_ID,
  accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
}, body, { labels: labellerConfig.labels, apply, hideUnmanaged }, { write: apply })
console.log(JSON.stringify({ applied: apply, ...changes }, null, 2))
