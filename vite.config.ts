import { nitro } from 'nitro/vite'
import { defineConfig, loadEnv } from 'vite'
import { vitehub } from 'vite-hub'
import { env } from 'vite-hub/env'

/**
 * Where the labeller runs. `cloudflare` (the default) is a Worker with KV, Cron Triggers, and Durable Object state.
 * `node` is one Node process, as in the Docker image: KV and Agent state in files under `.data/`, and the
 * Schedules on a timer inside the process.
 */
const host = process.env.LABELLER_HOST === 'node' ? 'node' : 'cloudflare'
// Cloudflare settings that the build reads: `.env` locally, build variables in Workers Builds.
const deployment = loadEnv('production', process.cwd(), '')

export default defineConfig({
  plugins: [
    vitehub({
      host,
      env: {
        server: {
          // Jev through Vercel AI Gateway: AI_GATEWAY_API_KEY
          vercel: { apiKey: env({ optional: true, secret: true, source: env.source('AI_GATEWAY_API_KEY') }) },
          executor: {
            url: env({ source: env.source('EXECUTOR_URL') }),
            apiKey: env({ secret: true, source: env.source('EXECUTOR_API_KEY') }),
            // Executor v2 account ID of the Gmail account, `acc_…`
            account: env({ source: env.source('EXECUTOR_GMAIL_ACCOUNT') }),
            // Cloudflare Access service token, when Executor sits behind Cloudflare Access.
            accessClientId: env({ optional: true, secret: true, source: env.source('CF_ACCESS_CLIENT_ID') }),
            accessClientSecret: env({ optional: true, secret: true, source: env.source('CF_ACCESS_CLIENT_SECRET') }),
          },
          gmail: {
            pubsubTopic: env({ optional: true, source: env.source('GMAIL_PUBSUB_TOPIC') }),
            pubsubAudience: env({ optional: true, source: env.source('PUBSUB_AUDIENCE') }),
            pubsubServiceAccount: env({ optional: true, source: env.source('PUBSUB_SERVICE_ACCOUNT') }),
            pubsubSubscription: env({ optional: true, source: env.source('GMAIL_PUBSUB_SUBSCRIPTION') }),
          },
        },
      },
      comments: false,
      database: false,
      // Open the deployed app at console.vitehub.dev. The Console signs each call; the app keeps its public key in a
      // VITEHUB_CONSOLE_KEY_* variable. `vite dev` serves the Operations endpoint to this machine only.
      console: true,
      schedule: host === 'node' ? { runtime: { driver: 'process' } } : true,
      workflow: false,
      ...host === 'node'
        ? {
            trustProxy: true,
            kv: { driver: 'fs-lite', base: '.data/kv' },
            // The Gmail Channel keeps its history cursor and mailbox lock in libSQL (VITEHUB_AGENT_STATE_URL).
            agent: { providers: { state: { driver: 'libsql', url: process.env.VITEHUB_AGENT_STATE_URL || 'file:.data/agent-state.db' } } },
          }
        : {
            // ViteHub serves the Worker on this custom domain instead of workers.dev.
            ...deployment.CLOUDFLARE_WORKER_DOMAIN && { publicUrl: `https://${deployment.CLOUDFLARE_WORKER_DOMAIN}` },
            // ViteHub writes the `KV` binding and the Agent state Durable Object.
            kv: { driver: 'cloudflare', namespaceId: deployment.CLOUDFLARE_KV_NAMESPACE_ID },
            agent: true,
          },
    }),
    nitro() as never,
  ],
})
