import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { vitehub } from 'vite-hub'
import { env } from 'vite-hub/env'

export default defineConfig(({ command }) => ({
  env: {
    server: {
      // Jev through Vercel AI Gateway: AI_GATEWAY_API_KEY
      vercel: { apiKey: env({ optional: true, secret: true, source: env.source('AI_GATEWAY_API_KEY') }) },
      executor: {
        url: env({ default: 'https://executor.onmax.me', source: env.source('EXECUTOR_URL') }),
        apiKey: env({ secret: true, source: env.source('EXECUTOR_API_KEY') }),
        // Executor v2 account ID of the Gmail account, `acc_…`
        account: env({ source: env.source('EXECUTOR_GMAIL_ACCOUNT') }),
        // Cloudflare Access service token for the public Executor URL. Not needed for the local URL.
        accessClientId: env({ optional: true, secret: true, source: env.source('CF_ACCESS_CLIENT_ID') }),
        accessClientSecret: env({ optional: true, secret: true, source: env.source('CF_ACCESS_CLIENT_SECRET') }),
      },
      gmail: {
        pubsubTopic: env({ optional: true, source: env.source('GMAIL_PUBSUB_TOPIC') }),
        pubsubAudience: env({ optional: true, source: env.source('PUBSUB_AUDIENCE') }),
        pubsubServiceAccount: env({ optional: true, source: env.source('PUBSUB_SERVICE_ACCOUNT') }),
        pubsubSubscription: env({ optional: true, source: env.source('GMAIL_PUBSUB_SUBSCRIPTION') }),
      },
      labeller: {
        // Prefer ViteHub's shared secret for admin access. Keep the old name as a
        // fallback so existing Workers keep accepting their configured token.
        adminToken: env({
          optional: true,
          secret: true,
          source: env.source(['VITEHUB_SECRET', 'LABELLER_ADMIN_TOKEN'], { skipEmpty: true }),
        }),
      },
    },
  },
  plugins: [
    vitehub({
      // This template uses Worker KV and Cloudflare Cron. ViteHub owns the
      // Nitro output for this preset; nitro.config.ts only supplies bindings.
      preset: 'cloudflare',
      comments: false,
      database: false,
      // nitro.config.ts declares the KV namespace for Wrangler.
      kv: { driver: 'cloudflare-kv-binding' },
      agent: { providers: { state: { provider: 'cloudflare' } } },
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
