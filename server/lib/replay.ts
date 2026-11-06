import { defineAgent } from 'vite-hub/agent'
import { replayChannel } from 'vite-hub/agent/server'
import * as v from 'valibot'
import labeller from '../agents/labeller'
import config from '../../labeller.config'
import { settings } from './settings'

const decisionSchema = v.object({
  label: v.union([v.string(), v.object({ choice: v.string(), confidence: v.number(), probabilities: v.optional(v.record(v.string(), v.number())) })]),
  rule: v.optional(v.string()),
})

// A child layer's hook replaces its parent's, so replay calls the preset's hook, which applies the label and its actions.
const applyDecision = labeller.hooks?.['agent:finish']

export async function replay(options: { query: string, max: number, pageToken?: string, ids?: string[], preview?: boolean, relabel?: boolean }) {
  const decisions: { messageId: string, result: v.InferOutput<typeof decisionSchema> }[] = []
  const agent = defineAgent({
    extends: labeller,
    // Admin previews and backfills do not persist private mail or classification results.
    invocations: false,
    hooks: {
      async 'agent:finish'(event) {
        const { message, result } = event
        if (!message) return
        const decision = v.parse(decisionSchema, result)
        decisions.push({ messageId: message.data.id, result: decision })
        if (options.relabel) {
          const label = typeof decision.label === 'string' ? decision.label : decision.label.choice
          const confidence = typeof decision.label === 'string' ? 1 : decision.label.confidence
          const selected = confidence >= settings.LABELLER_MIN_CONFIDENCE && Object.hasOwn(config.labels, label) ? label : undefined
          await message.modify({ removeLabels: Object.keys(config.labels).filter(name => name !== selected) })
        }
        await applyDecision?.(event)
      },
    },
  })
  const result = await replayChannel(agent, 'gmail', {
    dryRun: options.preview === true || settings.LABELLER_DRY_RUN,
    force: true,
    limit: options.max,
    cursor: options.pageToken,
    query: options.ids ? { ids: options.ids } : { query: options.query },
  })
  return { ...result, decisions }
}
