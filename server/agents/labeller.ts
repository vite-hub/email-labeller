import { defineAgent } from 'vite-hub/agent'
import { vercel } from 'vite-hub/gateways'
import { labeller } from 'vite-hub/presets/labeller'
import config from '../../labeller.config'
import { gmailClient } from '../lib/gmail'
import { settings } from '../lib/settings'

const agent = defineAgent({
  extends: labeller,
  runtime: false,
  messages: { transcripts: false },
  options: {
    ...config,
    client: gmailClient,
    bodyLimit: settings.LABELLER_BODY_LIMIT,
    dryRun: settings.LABELLER_DRY_RUN,
    trashEnabled: settings.LABELLER_TRASH_ENABLED,
    minConfidence: settings.LABELLER_MIN_CONFIDENCE,
    maxAttempts: 3,
  },
  driver: { gateway: vercel({ model: 'typesafe-ai/jev' }) },
})

export default agent

// The preset defines the Channel; its type leaves `channels` optional.
const channel = agent.channels?.gmail
if (!channel) throw new TypeError('The labeller preset defines no Gmail Channel.')
/** The poll Schedule, `/api/sync`, and `/api/health` read this Channel. */
export const gmailChannel = channel
