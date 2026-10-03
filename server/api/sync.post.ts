import { defineEventHandler } from 'h3'
import { requireAdmin } from '../lib/admin'
import { renewWatch, sync } from '../lib/sync'

/** Renews the Gmail watch when needed and processes new Inbox messages now. */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const watching = await renewWatch()
  return { watching, decisions: await sync() }
})
