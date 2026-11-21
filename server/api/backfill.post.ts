import { defineEventHandler, readValidatedBody } from 'h3'
import * as v from 'valibot'
import { requireServiceToken } from 'vite-hub/env'
import { replay } from '../lib/replay'

const bodySchema = v.object({
  query: v.optional(v.string(), 'in:inbox'),
  max: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 50),
  pageToken: v.optional(v.string()),
  ids: v.optional(v.pipe(v.array(v.string()), v.maxLength(100))),
  relabel: v.optional(v.boolean(), false),
})

export default defineEventHandler(async (event) => {
  requireServiceToken(event, 'VITEHUB_SECRET')
  const options = await readValidatedBody(event, body => v.parse(bodySchema, body ?? {}))
  return replay(options)
})
