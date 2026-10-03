import { timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { useServerEnv } from '#vitehub/env/server'

const accessKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/** Accepts a Cloudflare Access login for the Console application. */
async function hasAccessLogin(token: string | undefined): Promise<boolean> {
  const { teamDomain, audience } = useServerEnv().access
  if (!token || !teamDomain || !audience) return false
  const issuer = `https://${teamDomain}`
  let keys = accessKeys.get(issuer)
  if (!keys) accessKeys.set(issuer, keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)))
  try {
    await jwtVerify(token, keys, { issuer, audience })
    return true
  }
  catch {
    return false
  }
}

/** Accepts HTTP Basic auth with any user name and LABELLER_ADMIN_TOKEN as the password, for scripts. */
function hasAdminPassword(header: string | undefined): boolean {
  const expected = useServerEnv().labeller.adminToken?.unseal()
  if (!expected || !header?.startsWith('Basic ')) return false
  const password = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':')
  const actual = Buffer.from(password)
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

/**
 * Protects the ViteHub Console. Cloudflare Access signs you in with your email; the Worker verifies the Access token
 * so the Console stays closed if the Access application is removed.
 */
export default defineEventHandler(async (event) => {
  const path = event.url.pathname
  if (!path.startsWith('/_vitehub') && !path.startsWith('/api/_vitehub')) return
  if (await hasAccessLogin(getHeader(event, 'cf-access-jwt-assertion'))) return
  if (hasAdminPassword(getHeader(event, 'authorization'))) return
  setResponseHeader(event, 'www-authenticate', 'Basic realm="Email labeller Console"')
  throw createError({ statusCode: 401, message: 'Unauthorized' })
})
