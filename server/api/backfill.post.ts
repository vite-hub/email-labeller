import { defineEventHandler, readValidatedBody } from 'h3'
import * as v from 'valibot'
import { requireAdmin } from '../lib/admin'
import * as gmail from '../lib/gmail'
import { processMessages } from '../lib/sync'

const bodySchema = v.object({
  query: v.optional(v.string(), 'in:inbox'),
  max: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 50),
  pageToken: v.optional(v.string()),
  /** Process these message IDs instead of a search page. */
  ids: v.optional(v.pipe(v.array(v.string()), v.maxLength(100))),
  /** Decide messages again and replace their managed labels. */
  relabel: v.optional(v.boolean(), false),
})

/**
 * Runs the labeller on existing messages from a Gmail search, one page per request, or on up to 100 given IDs.
 * Every call decides messages again. `relabel` also replaces their managed labels.
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const { query, max, pageToken, ids, relabel } = await readValidatedBody(event, body => v.parse(bodySchema, body ?? {}))
  const page = ids ? { ids, nextPageToken: undefined } : await gmail.searchMessagePage(query, max, pageToken)
  return { decisions: await processMessages(page.ids, { relabel }), nextPageToken: page.nextPageToken }
})
