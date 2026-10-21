import { defineConfig } from 'nitro'
import { loadEnv } from 'vite'

// Only nonsecret values below enter the generated Worker config.
const deployment = loadEnv('production', process.cwd(), '')
const variables = [
  'EXECUTOR_URL', 'EXECUTOR_GMAIL_CONNECTION',
  'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD',
  'GMAIL_PUBSUB_TOPIC', 'GMAIL_PUBSUB_SUBSCRIPTION', 'PUBSUB_AUDIENCE', 'PUBSUB_SERVICE_ACCOUNT',
  'LABELLER_DRY_RUN', 'LABELLER_TRASH_ENABLED', 'LABELLER_CLEANUP_ENABLED', 'LABELLER_MIN_CONFIDENCE',
]

export default defineConfig({
  compatibilityDate: '2026-10-01',
  serverDir: 'server',
  cloudflare: {
    wrangler: {
      ...deployment.CLOUDFLARE_ACCOUNT_ID && { account_id: deployment.CLOUDFLARE_ACCOUNT_ID },
      ...deployment.CLOUDFLARE_WORKER_DOMAIN && {
        routes: [{ pattern: deployment.CLOUDFLARE_WORKER_DOMAIN, custom_domain: true }],
      },
      // Workers Logs keeps console output searchable in the dashboard and through the API.
      observability: { enabled: true },
      vars: Object.fromEntries(variables.flatMap(name => deployment[name] ? [[name, deployment[name]]] : [])),
      kv_namespaces: [{
        binding: 'KV',
        // Local preview works before a namespace is created. `pnpm run deploy` rejects this placeholder.
        id: deployment.CLOUDFLARE_KV_NAMESPACE_ID || '00000000000000000000000000000000',
      }],
    },
  },
})
