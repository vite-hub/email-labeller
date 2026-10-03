import { useServerEnv } from '#vitehub/env/server'
import { ask, defineAgent } from 'vite-hub/agent'
import { emailSchema, jevLabels, matchRule } from '../lib/labeller'

/**
 * Labels one Gmail message. Rules from `labeller.config.ts` decide first; Jev chooses a label only when no rule matches.
 * The Agent never changes Gmail: the caller applies its output. The Console records one session per email.
 */
export default defineAgent({
  description: 'Labels Gmail messages: config rules first, then Jev.',
  runtime: false,
  data: emailSchema,
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
