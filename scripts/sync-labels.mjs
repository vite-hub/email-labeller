const token = process.env.VITEHUB_SECRET || process.env.LABELLER_ADMIN_TOKEN
if (!token) throw new Error('VITEHUB_SECRET is required')
const base = process.env.LABELLER_URL || 'https://email-labeller.onmax.me'
const response = await fetch(new URL('/api/labels', base), {
  method: 'POST',
  headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    apply: process.argv.includes('--apply'),
    hideUnmanaged: process.argv.includes('--hide-unmanaged'),
  }),
})
if (!response.ok) throw new Error(`Label sync failed with HTTP ${response.status}: ${await response.text()}`)
console.log(JSON.stringify(await response.json(), null, 2))
