import { defineConfig } from 'nitro'
import { loadEnv } from 'vite'

// Only nonsecret values below enter the generated Worker config.
const deployment = loadEnv('production', process.cwd(), '')
const variables = [
  'EXECUTOR_URL', 'EXECUTOR_GMAIL_ACCOUNT',
  'GMAIL_PUBSUB_TOPIC', 'GMAIL_PUBSUB_SUBSCRIPTION', 'PUBSUB_AUDIENCE', 'PUBSUB_SERVICE_ACCOUNT',
  'LABELLER_DRY_RUN', 'LABELLER_TRASH_ENABLED', 'LABELLER_CLEANUP_ENABLED', 'LABELLER_MIN_CONFIDENCE', 'LABELLER_BODY_LIMIT',
]

export default defineConfig({
  compatibilityDate: '2026-10-01',
  serverDir: 'server',
  cloudflare: {
    wrangler: {
      ...deployment.CLOUDFLARE_ACCOUNT_ID && { account_id: deployment.CLOUDFLARE_ACCOUNT_ID },
      // Workers Logs keeps console output searchable in the dashboard and through the API. Invocation logs are off:
      // every Agent state call is its own Durable Object invocation, and those entries filled the Workers Logs quota.
      observability: { enabled: true, logs: { invocation_logs: false } },
      // ViteHub doesn't write Worker vars from Server Env yet, so the non-secret settings are listed here.
      vars: {
        ...Object.fromEntries(variables.flatMap(name => deployment[name] ? [[name, deployment[name]]] : [])),
        // Public key of the console.vitehub.dev link for email-labeller.onmax.me. In your own copy, replace it with the
        // line that the Console shows when you link your app.
        VITEHUB_CONSOLE_KEY_CONSOLE_69E3AECB: '_gX0wBcTUEWQ5RU73b94PNTWv0e4bA_TzxvMRwvlXmc',
      },
    },
  },
})
