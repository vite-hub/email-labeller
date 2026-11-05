import { defineEventHandler, readValidatedBody } from 'h3'
import * as v from 'valibot'
import { gmail, syncGmailChannel } from 'vite-hub/agent/channels'
import config from '../../labeller.config'
import { requireAdmin } from '../lib/admin'
import { gmailClient } from '../lib/gmail'

const schema = v.object({
  apply: v.optional(v.boolean(), false),
  hideUnmanaged: v.optional(v.boolean(), false),
})

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { apply, hideUnmanaged } = await readValidatedBody(event, body => v.parse(schema, body ?? {}))
  return syncGmailChannel(gmail({ client: gmailClient, labels: config.labels, hideUnmanagedLabels: hideUnmanaged }), { apply })
})
