# Email labeller

Labels Maxi's Gmail on a Cloudflare Worker at https://email-labeller.onmax.me. The same app also builds as a Docker image (`LABELLER_HOST=node`). Rules run first and Jev (`typesafe-ai/jev` through Vercel AI Gateway) labels the rest. Production runs live, with trash and cleanup enabled.

## Rules

- Jev decides labels. Never pick labels by hand. If Jev gets something wrong, improve the label descriptions in `labeller.config.ts`, deploy, and backfill the affected messages with `relabel: true`. `api preview` shows Jev's choice and probability for each message.
- Change Gmail through the Worker's admin endpoints, not directly. They apply the same rules and Jev as production.
- Gmail allows a limited number of API calls per minute, shared with the live Worker. Send work in batches and wait when you get a 403.

## Access

- `.env` (gitignored) has the production settings and `VITEHUB_SECRET`, the bearer token for `/api/*`.
- Executor (`tools.gmail.gmail.users.*`) gives direct Gmail access, but only for reads.
- Cloudflare (Executor `tools.cloudflare`) manages Worker secrets. Secret values can't be read back. To rotate the token, set a new `VITEHUB_SECRET` on the Worker, then update `.env`.
- Cloudflare Workers Builds deploys every push to `main` with `pnpm build && pnpm typecheck`, then `pnpm run deploy`. It doesn't read `.env`: its settings are the build variables under Settings → Builds on the `email-labeller` Worker. When you add or rename a setting in `nitro.config.ts`, change it there too. `scripts/deploy.mjs` refuses a build without `EXECUTOR_URL` or `EXECUTOR_GMAIL_ACCOUNT`. The GitHub Actions deploy is skipped (`DEPLOY_ENABLED` is off).
- To deploy by hand, run `pnpm build && pnpm run deploy` after loading `.env`. `wrangler versions upload --config .output/server/wrangler.json` checks Worker startup without going live.
- After upgrading ViteHub, check Worker startup with `wrangler versions upload`. ViteHub keeps the Console journal in memory on Workers, and if that fallback regresses, startup fails because libsql rejects `file:` URLs.

## Common tasks

```sh
set -a; . ./.env; set +a
api() { curl -s -X POST "https://email-labeller.onmax.me/api/$1" -H "authorization: Bearer $VITEHUB_SECRET" -H 'content-type: application/json' -d "${2:-{\}}"; }

curl -s https://email-labeller.onmax.me/api/health -H "authorization: Bearer $VITEHUB_SECRET"  # 503 while sync fails; shows the error and skipped messages
api sync                                                       # repeat while it returns "more": true
api preview  '{"query":"in:inbox","max":10}'                 # read-only
api backfill '{"query":"in:inbox has:nouserlabels","max":100}' # repeat with pageToken
api backfill '{"ids":["..."],"relabel":true}'                  # let Jev redo labels
api cleanup                                                    # trash old labelled mail
```

See `README.md` for setup, rules syntax, and deployment.

## Console and push

- console.vitehub.dev signs its calls to `POST /_vitehub/rpc`. The Worker needs the `VITEHUB_CONSOLE_KEY_*` secret that the Console shows when you link the app. Cloudflare Access must not cover `/_vitehub`, or the Console's calls get a login redirect.
- Gmail push reaches `/api/_vitehub/agents/labeller/webhooks/gmail`. A separate Access app with a bypass policy lets Pub/Sub through; the Channel verifies Google's OIDC token. If pushes fail, `wrangler tail email-labeller` shows their status.
