import { defineEventHandler } from 'h3'
import { requireServiceToken } from 'vite-hub/env'
import { cleanup } from '../lib/cleanup'

/** Runs `cleanup` rules now. While cleanup is disabled, this previews the messages they would trash. */
export default defineEventHandler(async (event) => {
  requireServiceToken(event, 'VITEHUB_SECRET')
  return { cleanup: await cleanup() }
})
