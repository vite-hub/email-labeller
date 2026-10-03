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
      // Cloudflare Access application that signs in to the Console at /_vitehub.
      access: {
        teamDomain: env({ optional: true, source: env.source('CF_ACCESS_TEAM_DOMAIN') }),
        audience: env({ optional: true, source: env.source('CF_ACCESS_AUD') }),
      },
      labeller: {
        adminToken: env({ optional: true, secret: true, source: env.source('LABELLER_ADMIN_TOKEN') }),
        // Record decisions without changing Gmail. Set LABELLER_DRY_RUN=false to apply them.
        dryRun: env({ default: 'true', source: env.source('LABELLER_DRY_RUN') }),
        // Keep destructive rules disabled until explicitly enabled for future messages.
        trashEnabled: env({ default: 'false', source: env.source('LABELLER_TRASH_ENABLED') }),
        // Apply `cleanup` rules from labeller.config.ts once a day.
        cleanupEnabled: env({ default: 'false', source: env.source('LABELLER_CLEANUP_ENABLED') }),
        // Minimum Jev probability to apply a label
        minConfidence: env({ default: '0.6', source: env.source('LABELLER_MIN_CONFIDENCE') }),

        // Labels, rules, and cleanup
        ...labellerConfig,
      },
    },
  },
  plugins: [
    vitehub({
      preset: 'cloudflare',
      database: {
        driver: 'd1',
        binding: 'DB',
        databaseName: 'email-labeller',
        databaseId: 'd82fb542-7741-4213-bd02-5d1936f615df',
      },
      // server/middleware/console-auth.ts protects /_vitehub with Cloudflare Access or LABELLER_ADMIN_TOKEN.
      // This app has no Channels or hosted chat, so Agents need no durable chat state (no CHAT_STATE Durable Object).
      agent: { providers: { state: { provider: 'memory' } } },
      console: { exposure: 'host-managed' },
      schedule: true,
      workflow: false,
    }),
    nitro() as never,
  ],
})
