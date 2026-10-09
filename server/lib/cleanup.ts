import { useServerEnv } from '#vitehub/env/server'
import * as gmail from './gmail'

/** Gmail's largest search page. Older matches are trashed on the next run. */
const maxPerRule = 500

export interface CleanupResult {
  rule: string
  query: string
  messageIds: string[]
  trashed: boolean
}

/** Quote names so spaces and nested labels keep their exact meaning. */
function labelQuery(name: string): string {
  return `label:${JSON.stringify(name)}`
}

/**
 * Finds messages that `cleanup` rules would move to Trash. They are trashed only when cleanup is enabled and dry-run
 * mode is off; otherwise the result is a preview.
 */
export async function cleanup(): Promise<CleanupResult[]> {
  const config = useServerEnv().labeller
  const trashed = config.cleanupEnabled && !config.dryRun
  const results: CleanupResult[] = []
  for (const [rule, { label, olderThan }] of Object.entries(config.cleanup ?? {})) {
    if (!Number.isSafeInteger(olderThan) || olderThan < 1) throw new Error(`Cleanup rule ${rule} needs a positive integer olderThan`)
    const query = `${labelQuery(label)} older_than:${olderThan}d -is:starred -in:trash`
    const messageIds = await gmail.searchMessageIds(query, maxPerRule)
    if (trashed) {
      await gmail.trashMessages(messageIds)
    }
    results.push({ rule, query, messageIds, trashed })
  }
  return results
}
