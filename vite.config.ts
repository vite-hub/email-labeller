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
        // Prefer ViteHub's shared secret for admin access. Keep the old name as a
        // fallback so existing Workers keep accepting their configured token.
        adminToken: env({
          optional: true,
          secret: true,
          source: env.source(['VITEHUB_SECRET', 'LABELLER_ADMIN_TOKEN'], { skipEmpty: true }),
        }),
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
      // Keep the Console available in production so the ViteHub CLI can run
      // the manual cleanup schedule through the authenticated Console route.
      console: command === 'serve'
        ? { auth: false }
        : {
            auth: {
              provider: 'cloudflare-access',
              teamDomain: env({ default: 'onmax.cloudflareaccess.com', source: env.source('CF_ACCESS_TEAM_DOMAIN') }),
              audience: env({ default: 'cc04032efa948a3dc79b7494c2919f9d30f9a484ed71cf8e6dc2d8e9a7f8d163', source: env.source('CF_ACCESS_AUD') }),
            },
            invoke: true,
          },
      schedule: true,
      workflow: false,
    }),
    nitro() as never,
  ],
}))
