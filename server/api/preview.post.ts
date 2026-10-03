import { defineEventHandler, readValidatedBody } from 'h3'
import * as v from 'valibot'
import { requireAdmin } from '../lib/admin'
import * as gmail from '../lib/gmail'
import { decide } from '../lib/sync'

const bodySchema = v.object({
  query: v.optional(v.string(), 'in:inbox'),
  max: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)), 10),
})

/** Shows what the labeller would do for a Gmail search. Never changes Gmail or records decisions. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { query, max } = await readValidatedBody(event, body => v.parse(bodySchema, body ?? {}))
  const emails = await gmail.getEmails(await gmail.searchMessageIds(query, max), await gmail.listLabels())
  return Promise.all(emails.map(decide))
})
