import { defineConfig } from 'nitro'

export default defineConfig({
  preset: 'cloudflare-module',
  serverDir: 'server',
  cloudflare: {
    wrangler: {
      account_id: 'ba6e044dfdaaffec3cac45e9feccd237',
      routes: [{ pattern: 'email-labeller.onmax.me', custom_domain: true }],
      vars: {
        EXECUTOR_URL: 'https://executor.onmax.me',
        EXECUTOR_GMAIL_CONNECTION: 'personalGmail',
        GMAIL_PUBSUB_TOPIC: 'projects/maxios-gog-mg-20260802/topics/email-labeller-gmail',
        GMAIL_PUBSUB_SUBSCRIPTION: 'projects/maxios-gog-mg-20260802/subscriptions/email-labeller-gmail-push',
        PUBSUB_AUDIENCE: 'https://email-labeller.onmax.me/gmail/push',
        PUBSUB_SERVICE_ACCOUNT: 'email-labeller-push@maxios-gog-mg-20260802.iam.gserviceaccount.com',
        CF_ACCESS_TEAM_DOMAIN: 'onmax.cloudflareaccess.com',
        // Audience tag of the "Email labeller Console" Access application.
        CF_ACCESS_AUD: 'cc04032efa948a3dc79b7494c2919f9d30f9a484ed71cf8e6dc2d8e9a7f8d163',
        LABELLER_DRY_RUN: 'false',
        LABELLER_TRASH_ENABLED: 'true',
        LABELLER_CLEANUP_ENABLED: 'true',
        LABELLER_MIN_CONFIDENCE: '0.6',
      },
      // `agent.providers.state: 'memory'` removed the unused CHAT_STATE Durable Object. Its first migration
      // created the class in the deployed Worker, so a second one must delete it.
      migrations: [
        { tag: 'vitehub-agent-state-v1', new_sqlite_classes: ['ViteHubAgentStateDO'] },
        { tag: 'remove-agent-state', deleted_classes: ['ViteHubAgentStateDO'] },
      ],
      d1_databases: [{
        binding: 'DB',
        database_name: 'email-labeller',
        database_id: 'd82fb542-7741-4213-bd02-5d1936f615df',
      }],
    },
  },
})
