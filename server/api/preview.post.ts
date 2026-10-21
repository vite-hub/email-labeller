import { defineEventHandler, readValidatedBody } from 'h3'
import * as v from 'valibot'
import { requireAdmin } from '../lib/admin'
import * as gmail from '../lib/gmail'
import { decide, describeError } from '../lib/sync'

const bodySchema = v.object({
  query: v.optional(v.string(), 'in:inbox'),
  max: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)), 10),
})

/** Shows what the labeller would do for a Gmail search. Never changes Gmail or the sync cursor. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { query, max } = await readValidatedBody(event, body => v.parse(bodySchema, body ?? {}))
  const { emails, failed } = await gmail.getEmails(await gmail.searchMessageIds(query, max), await gmail.listLabels())
  const results = await Promise.allSettled(emails.map(decide))
  return {
    decisions: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
    failed: [
      ...failed,
      ...results.flatMap((result, index) => result.status === 'rejected' ? [{ messageId: emails[index]!.id, error: describeError(result.reason) }] : []),
    ],
  }
})
