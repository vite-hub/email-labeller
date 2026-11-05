import { defineEventHandler, readValidatedBody } from 'h3'
import * as v from 'valibot'
import { requireAdmin } from '../lib/admin'
import { replay } from '../lib/replay'

const bodySchema = v.object({
  query: v.optional(v.string(), 'in:inbox'),
  max: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)), 10),
})

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const options = await readValidatedBody(event, body => v.parse(bodySchema, body ?? {}))
  return replay({ ...options, preview: true })
})
