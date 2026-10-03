/** The Worker bindings from `nitro.config.ts`, available in requests and Cron Triggers. */
declare module 'cloudflare:workers' {
  export const env: Readonly<Record<string, unknown>>
}
