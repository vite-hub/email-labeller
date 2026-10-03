# Email labeller

Labels new Gmail messages. Rules from `labeller.config.ts` decide first. When no rule matches, TypeSafe Jev chooses one of your labels. Jev requests go through Vercel AI Gateway with `AI_GATEWAY_API_KEY`.

```text
Gmail watch -> Pub/Sub push -> authenticated POST /gmail/push -> sync()
ViteHub Schedule -> Cloudflare Cron every five minutes -> reconcile and renew watch
  -> Gmail history since the stored cursor -> new Inbox messages
  -> labeller Agent: intercept(rules) or driver.ask (Jev)
  -> apply label changes through Executor -> record decision
```

- `server/agents/labeller.ts`: the Agent. `intercept()` returns the first matching rule, which skips Jev. `driver.ask` asks Jev for a label.
- `server/lib/gmail.ts`: Gmail through Executor code mode. Executor keeps the Google OAuth credential.
- `server/lib/sync.ts`: history cursor, idempotent processing, label changes, and watch renewal. `server/lib/sync-lease.ts` lets one sync run at a time across Worker isolates.
- `server/routes/gmail/push.post.ts`: validates authenticated Pub/Sub push notifications.
- `server/schedules/gmail.ts`: reconciles Gmail history and renews the watch every five minutes through ViteHub Schedule.
- `labeller.config.ts`: labels with Gmail colors and Jev descriptions, rules, and cleanup. `vite.config.ts` passes it to `env.server.labeller`.
- `server/lib/cleanup.ts`, `server/schedules/cleanup.ts`: move old messages to Trash by label once a day, only when Trash is enabled.
- `scripts/sync-labels.mjs`: creates missing active labels and hides superseded labels in the sidebar without deleting labels or changing messages.
- `server/api/preview.post.ts`, `server/api/sync.post.ts`, `server/api/replay.post.ts`, `server/api/cleanup.post.ts`, `server/api/backfill.post.ts`: admin endpoints (`Authorization: Bearer $LABELLER_ADMIN_TOKEN`). Replay applies up to 100 previously recorded dry-run messages after live mode is enabled. Cleanup runs the cleanup rules now, or previews them while Trash is disabled. Backfill runs the labeller on existing messages from a Gmail search, one page per request, or on up to 100 given `ids`; pass `nextPageToken` back until it is absent. Add `relabel: true` after changing labels or rules: it decides messages again and replaces their managed labels.

## Configure

Edit `labeller.config.ts`. It has three parts:

```ts
export default {
  labels: {
    'GitHub/Bots': { color: { textColor: '#000000', backgroundColor: '#cccccc' } },
    'Security': {
      description: 'Sign-in alerts, new devices, verification codes, 2FA, password resets, and expiring tokens',
      color: { textColor: '#ffffff', backgroundColor: '#fb4c2f' },
    },
  },
  rules: {
    deleteGithubBots: {
      from: 'notifications@github.com',
      subject: '/^Re:/i',
      header: { 'x-github-sender': '/\\[bot\\]$/i' },
      label: 'GitHub/Bots',
      trash: true,
    },
    github: { from: 'notifications@github.com', label: 'GitHub' },
  },
  cleanup: {
    promotions: { label: 'Promotions', olderThan: 14 },
  },
} satisfies LabellerConfig
```

- `labels`: the Gmail labels this app manages. Colors must come from [Gmail's label palette](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels). A label with a `description` is available to Jev when no rule matches. Gmail has no description field, so the description only guides Jev.
- `rules`: run in order, and the first match wins and skips Jev. Text matches are case-insensitive substrings, or a regular expression written as `"/pattern/flags"`. A list matches any item. Fields: `from`, `to`, `subject`, `body`, `listId`, `hasLabel`, `header`, and `not`. Actions: `label`, `archive`, `read`, `star`, and `trash`. A rule without actions leaves the message unchanged and skips Jev.
- `cleanup`: once a day, moves messages with the label that are older than `olderThan` days to Trash. Starred messages are kept.

`LABELLER_TRASH_ENABLED=true` lets rules with `trash: true` move new messages to Trash; the `deleteGithubBots` rule uses it for GitHub bot notifications. `LABELLER_CLEANUP_ENABLED=true` separately enables the daily `cleanup` rules. Preview cleanup with `POST /api/cleanup`. Gmail deletes messages in Trash after 30 days.

Copy `.env.example` to `.env` for local development. The deployed Worker reads its own Cloudflare secrets and bindings. Set `LABELLER_DRY_RUN=true` to record decisions without changing Gmail.

Preview label changes with `pnpm labels:sync`, then apply them with `pnpm labels:sync --apply`. It creates missing labels, applies colors, and hides other user labels in the sidebar. It never deletes labels or edits messages. The app only processes messages added after its saved Gmail history cursor; changing rules does not retroactively process older mail.

## Console

The ViteHub Console runs at `https://email-labeller.onmax.me/_vitehub`. The Cloudflare Access application "Email labeller Console" (team `onmax.cloudflareaccess.com`) covers `/_vitehub` and `/api/_vitehub` and allows only `maximogarciamtnez@gmail.com`, through Cloudflare login or an email code. ViteHub's `cloudflare-access` Console auth also verifies the Access token (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`), so the Console stays closed if the Access application is removed. Scripts can use an Access service token. Every labelled email is one Agent session. Its prompt is the sender and subject, and its output is the rule decision or the Jev choice.

The Console stores sessions in the Worker's D1 database, in the `vitehub_agent_invocations` table, and creates the table on first use. It keeps the last 50,000 sessions for up to 30 days (`console.retention` in `vite.config.ts`). Local development uses the Console's default SQLite history instead.

## Local development

```sh
corepack pnpm install
corepack pnpm db:migrate
corepack pnpm dev
```

Tests run with Node's test runner. The lease tests use a local D1 database from Miniflare:

```sh
corepack pnpm build  # generates .vitehub/types for typecheck
corepack pnpm typecheck
corepack pnpm test
```

Preview decisions for a Gmail search without changing Gmail:

```sh
curl -X POST localhost:3000/api/preview -H "authorization: Bearer $LABELLER_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"query":"in:inbox","max":10}'
```

## Cloudflare deployment

The Worker is deployed at `https://email-labeller.onmax.me` with a D1 database, a five-minute sync Cron Trigger, a daily cleanup Cron Trigger, `LABELLER_DRY_RUN=false`, `LABELLER_TRASH_ENABLED=true`, and `LABELLER_CLEANUP_ENABLED=true`. Its secrets include an Executor API key, an AI Gateway key, an admin token, and a dedicated Cloudflare Access service token for `executor.onmax.me`. New GitHub bot notifications move to Trash with the `GitHub/Bots` label; other GitHub notifications receive `GitHub`. Cleanup rules move Promotions older than 14 days and Security older than 30 days to Trash once a day. Older messages are left alone.

Gmail watch publishes to Google Pub/Sub, whose authenticated push subscription calls `/gmail/push`. The schedule reconciles missed notifications and renews the watch. The Pub/Sub topic and subscription are in Google Cloud project `maxios-gog-mg-20260802`.

Every push to `main` deploys the Worker through `.github/workflows/deploy.yml`. The workflow installs, builds, typechecks, tests, and runs `wrangler deploy`. Run it again from the Actions tab with "Run workflow". It needs the `CLOUDFLARE_API_TOKEN` repository secret, a Cloudflare API token with Workers Scripts, Workers Routes, and D1 edit access.

To deploy from a local checkout:

```sh
pnpm build
pnpm typecheck
pnpm exec wrangler deploy --config .output/server/wrangler.json
```

The D1 binding, custom domain, Cron Trigger, and nonsecret variables come from `nitro.config.ts`. Nonsecret values that match the defaults in `vite.config.ts` are not repeated there.

The deploy workflow does not migrate D1. Apply each new file in `server/databases/migrations/` before you deploy code that needs it:

```sh
pnpm exec wrangler d1 execute email-labeller --remote --file server/databases/migrations/0002_sync_lease.sql
```

Earlier migrations were applied this way, not with `wrangler d1 migrations apply`. That command tracks applied files in its own `d1_migrations` table, so it could run every migration again. Cloudflare stores secrets separately from `.env`; never put their values in Wrangler config.

## Patches

`patches/` holds dependency fixes until they are released upstream. Remove each one when the app upgrades to a release that includes it. The `vite-hub` build in `package.json` no longer needs the earlier `vite-hub`, `@vite-hub/agent`, and `@vite-hub/env` patches.

- `nitro`: type declarations for `nitro/h3`.
- `pkce-challenge`: a default browser export for Worker bundling through `@ai-sdk/mcp`.

Agents use `agent: { providers: { state: { provider: 'memory' } } }`: this app has no Channels or hosted chat, so it needs no `CHAT_STATE` Durable Object. `nitro.config.ts` keeps the migration that deleted that class from the deployed Worker.
