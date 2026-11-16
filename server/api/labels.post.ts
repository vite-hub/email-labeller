import { defineEventHandler, readValidatedBody } from 'h3'
import * as v from 'valibot'
import { gmail, syncGmailChannel } from 'vite-hub/channels/adapters'
import { requireServiceToken } from 'vite-hub/env'
import config from '../../labeller.config'
import { gmailClient } from '../lib/gmail'

const schema = v.object({
  apply: v.optional(v.boolean(), false),
  hideUnmanaged: v.optional(v.boolean(), false),
})

export default defineEventHandler(async (event) => {
  requireServiceToken(event, 'VITEHUB_SECRET')
  const { apply, hideUnmanaged } = await readValidatedBody(event, body => v.parse(schema, body ?? {}))
  return syncGmailChannel(gmail({ client: gmailClient, labels: config.labels, hideUnmanagedLabels: hideUnmanaged }), { apply })
})
