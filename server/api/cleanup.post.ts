import { defineEventHandler } from 'h3'
import { requireAdmin } from '../lib/admin'
import { cleanup } from '../lib/cleanup'

/** Runs `cleanup` rules now. While cleanup is disabled, this previews the messages they would trash. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  return { cleanup: await cleanup() }
})
