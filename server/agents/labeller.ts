import { useServerEnv } from '#vitehub/env/server'
import { ask, defineAgent } from 'vite-hub/agent'
import { type AgentInvocationD1Database, createD1AgentInvocationStore } from 'vite-hub/agent/invocations/d1'
import { defineAgentInvocations } from 'vite-hub/agent/server'
import { emailSchema, jevLabels, matchRule } from '../lib/labeller'

/**
 * Labels one Gmail message. Rules from `labeller.config.ts` decide first; Jev chooses a label only when no rule matches.
 * The Agent never changes Gmail: the caller applies its output.
 */
export default defineAgent({
  description: 'Labels Gmail messages: config rules first, then Jev.',
  runtime: false,
  data: emailSchema,
  // One Console session per email, stored in the Worker's D1 database. Apply `scripts/agent-invocations.sql` first.
  // Local development keeps the Console's default SQLite history.
  invocations: import.meta.dev
    ? undefined
    : defineAgentInvocations({
        store: createD1AgentInvocationStore({
          database: async () => (await import('cloudflare:workers')).env.DB as AgentInvocationD1Database,
          maxRecords: 50_000,
        }),
      }),
  intercept: ({ input }) => input.data === undefined ? undefined : matchRule(input.data, useServerEnv().labeller.rules),
  driver: {
    ask: () => ({
      label: ask.choice('Which Gmail label fits this email? Choose "none" if no label clearly fits.', {
        ...jevLabels(useServerEnv().labeller.labels),
        none: 'No label clearly fits this email.',
      }),
    }),
  },
})
