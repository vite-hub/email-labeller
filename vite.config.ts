import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { vitehub } from 'vite-hub'
import { env, typesafeEnv } from 'vite-hub/env'
import labellerConfig from './labeller.config.ts'

export default defineConfig(({ command }) => ({
  env: {
    server: {
      // Jev through Vercel AI Gateway: AI_GATEWAY_API_KEY
      typesafe: typesafeEnv({ provider: 'vercel' }),
      executor: {
        url: env({ default: 'https://executor.onmax.me', source: env.source('EXECUTOR_URL') }),
        apiKey: env({ secret: true, source: env.source('EXECUTOR_API_KEY') }),
        connection: env({ default: 'gmail', source: env.source('EXECUTOR_GMAIL_CONNECTION') }),
        // Cloudflare Access service token for the public Executor URL. Not needed for the local URL.
        accessClientId: env({ optional: true, secret: true, source: env.source('CF_ACCESS_CLIENT_ID') }),
        accessClientSecret: env({ optional: true, secret: true, source: env.source('CF_ACCESS_CLIENT_SECRET') }),
      },
      pubsub: {
        topic: env({ optional: true, source: env.source('GMAIL_PUBSUB_TOPIC') }),
        audience: env({ optional: true, source: env.source('PUBSUB_AUDIENCE') }),
        serviceAccount: env({ optional: true, source: env.source('PUBSUB_SERVICE_ACCOUNT') }),
        subscription: env({ optional: true, source: env.source('GMAIL_PUBSUB_SUBSCRIPTION') }),
      },
      labeller: {
        adminToken: env({ optional: true, secret: true, source: env.source('LABELLER_ADMIN_TOKEN') }),
        // Preview decisions without changing Gmail. Set LABELLER_DRY_RUN=false to apply them.
        dryRun: env.boolean({ default: true, source: env.source('LABELLER_DRY_RUN') }),
        // Keep destructive rules disabled until explicitly enabled for future messages.
        trashEnabled: env.boolean({ default: false, source: env.source('LABELLER_TRASH_ENABLED') }),
        // Apply `cleanup` rules from labeller.config.ts once a day.
        cleanupEnabled: env.boolean({ default: false, source: env.source('LABELLER_CLEANUP_ENABLED') }),
        // Minimum Jev probability to apply a label
        minConfidence: env.number({ default: 0.6, source: env.source('LABELLER_MIN_CONFIDENCE') }),

        // Labels, rules, and cleanup
        ...labellerConfig,
      },
    },
  },
  plugins: [
    vitehub({
      // This template uses Worker KV and Cloudflare Cron. ViteHub owns the
      // Nitro output for this preset; nitro.config.ts only supplies bindings.
      preset: 'cloudflare',
      // nitro.config.ts declares the KV namespace for Wrangler.
      kv: { driver: 'cloudflare-kv-binding' },
      // This app has no Channels or hosted chat, so Agents need no durable chat state (no CHAT_STATE Durable Object).
      agent: { providers: { state: { provider: 'memory' } } },
      // Enable the Console only for the dev server. No deployed SQL journal.
      console: command === 'serve',
      schedule: true,
      workflow: false,
    }),
    nitro() as never,
  ],
}))
