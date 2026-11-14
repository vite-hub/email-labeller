import { defineAgent } from 'vite-hub/agent'
import { replayChannel } from 'vite-hub/agent/server'
import labeller from '../agents/labeller'
import { settings } from './settings'

export async function replay(options: { query: string, max: number, pageToken?: string, ids?: string[], preview?: boolean, relabel?: boolean }) {
  const agent = defineAgent({
    extends: labeller,
    // Admin previews and backfills do not persist private mail or classification results.
    invocations: false,
    options: { relabel: options.relabel === true },
  })
  const result = await replayChannel(agent, 'gmail', {
    dryRun: options.preview === true || settings.LABELLER_DRY_RUN,
    force: true,
    limit: options.max,
    cursor: options.pageToken,
    query: options.ids ? { ids: options.ids } : { query: options.query },
  })
  const decisions = result.items.flatMap(item => item.status === 'completed' ? [{ messageId: item.key, result: item.output }] : [])
  return { ...result, decisions }
}
