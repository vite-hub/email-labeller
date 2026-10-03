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

/** Gmail search syntax for a label name: `label:dev-services`, `label:github-bots`. */
function labelQuery(name: string): string {
  return `label:${name.toLowerCase().replace(/[\s/]+/g, '-')}`
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
    const query = `${labelQuery(label)} older_than:${olderThan}d -is:starred -in:trash`
    const messageIds = await gmail.searchMessageIds(query, maxPerRule)
    if (trashed) await gmail.trashMessages(messageIds)
    results.push({ rule, query, messageIds, trashed })
  }
  return results
}
