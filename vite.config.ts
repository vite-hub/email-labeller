import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { vitehub } from 'vite-hub'
import { env, typesafeEnv } from 'vite-hub/env'
import labellerConfig from './labeller.config.ts'

export default defineConfig({
  env: {
    server: {
      // Jev through Vercel AI Gateway: AI_GATEWAY_API_KEY
      typesafe: typesafeEnv({ provider: 'vercel' }),
      executor: {
        url: env({ default: 'https://executor.onmax.me', source: env.source('EXECUTOR_URL') }),
        apiKey: env({ secret: true, source: env.source('EXECUTOR_API_KEY') }),
        connection: env({ default: 'personalGmail', source: env.source('EXECUTOR_GMAIL_CONNECTION') }),
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
        // Record decisions without changing Gmail. Set LABELLER_DRY_RUN=false to apply them.
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
      preset: 'cloudflare',
      // Enables Database on the D1 binding `DB`. nitro.config.ts declares that binding for Wrangler.
      database: { driver: 'd1' },
      // This app has no Channels or hosted chat, so Agents need no durable chat state (no CHAT_STATE Durable Object).
      agent: { providers: { state: { provider: 'memory' } } },
      // The Console at /_vitehub accepts only the Cloudflare Access application "Email labeller Console".
      // It reads CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD. Agent sessions are stored in the D1 database.
      console: {
        access: 'auth',
        auth: { provider: 'cloudflare-access' },
        retention: { maxRecords: 50_000, maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
      },
      schedule: true,
      workflow: false,
    }),
    nitro() as never,
  ],
})
