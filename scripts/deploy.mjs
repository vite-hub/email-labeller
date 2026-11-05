import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const configPath = '.output/server/wrangler.json'
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const namespace = config.kv_namespaces?.find(namespace => namespace.binding === 'KV')
if (!config.account_id || !namespace?.id || namespace.id === '00000000000000000000000000000000') {
  throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_KV_NAMESPACE_ID, then rebuild before deploying')
}
// nitro.config.ts drops empty vars, and the Worker fails every request without these.
const missing = ['EXECUTOR_GMAIL_ACCOUNT'].filter(name => !config.vars?.[name])
if (missing.length) throw new Error(`Set ${missing.join(', ')}, then rebuild before deploying`)
const result = spawnSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', configPath], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
