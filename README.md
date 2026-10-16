# Email labeller

Labels new Gmail Inbox messages with configurable rules and TypeSafe Jev through Vercel AI Gateway. Gmail operations go through [Executor](https://executor.onmax.me), which stores and refreshes the Google OAuth credential. The app runs on a Cloudflare Worker with KV storage for its Gmail cursor and watch expiry.

Start in dry-run mode. Rules, Trash actions, and cleanup are configurable, and the default settings make no changes to Gmail. Deployment targets come from your environment. No Cloudflare account, Worker domain, or KV namespace ID is hard-coded.

```text
Gmail watch -> Pub/Sub -> authenticated POST /gmail/push
  -> acknowledge -> sync Gmail history
Cloudflare Cron every five minutes -> renew watch and reconcile history
  -> rules first, Jev when no rule matches
  -> apply Gmail changes in live mode -> advance history cursor in KV
Cloudflare Cron daily -> optional cleanup by label and age
```

## Requirements

- Node.js 24.15 or later and pnpm 10.33.0 through Corepack.
- An Executor API key and a Gmail connection with permission to read messages, manage labels, modify messages, and start a watch. The Worker adapter uses an **org-owned** connection at `tools.gmail.org[connection].gmail.users`.
- A Vercel AI Gateway key with access to `typesafe-ai/jev` for messages that do not match a rule.
- A Cloudflare account and KV namespace for deployment.
- A Google Cloud Pub/Sub topic and authenticated push subscription for immediate notifications. Five-minute polling also works without a watch.

The project pins a Nitro 3 beta and the ViteHub labeller preset from an immutable `pkg.pr.new` commit. Keep `pnpm-lock.yaml` when copying it. The preset owns Gmail delivery, ordered rules, Jev fallback, and label actions for apps that use ViteHub’s Gmail OAuth client. This template keeps its Executor-backed client and local sync endpoints, so its `labeller.config.ts` remains the only app behavior configuration.

## Local setup

```sh
corepack pnpm install --frozen-lockfile
cp .env.example .env
```

Set these values in `.env`:

| Variable | Purpose |
| --- | --- |
| `EXECUTOR_URL` | Executor's API origin. Defaults to `https://executor.onmax.me`; override it for another instance. |
| `EXECUTOR_API_KEY` | Executor API key. |
| `EXECUTOR_GMAIL_CONNECTION` | Name of the org-owned Gmail connection. |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Service token if Executor requires Cloudflare Access. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access team domain and Console application audience. The production defaults target the existing Email labeller Console app. |
| `AI_GATEWAY_API_KEY` | Jev access through Vercel AI Gateway. |
| `VITEHUB_SECRET` | Shared ViteHub secret used as the bearer token for admin endpoints. |
| `LABELLER_ADMIN_TOKEN` | Compatibility fallback for deployments that still use the old admin token name. Missing both values closes admin endpoints. |
| `LABELLER_DRY_RUN` | Keep `true` while reviewing decisions. |
| `LABELLER_TRASH_ENABLED` | Defaults to `false`; gates rule actions with `trash: true`. |
| `LABELLER_CLEANUP_ENABLED` | Defaults to `false`; independently gates daily cleanup. |
| `LABELLER_MIN_CONFIDENCE` | Minimum Jev probability for applying a configured label; defaults to `0.6`. |

Leave the optional Pub/Sub values blank to use polling, or configure them as described below.

```sh
corepack pnpm dev
```

Use the URL printed by Vite. For example, if it uses port 3000:

```sh
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/preview \
  -H "authorization: Bearer $LABELLER_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"query":"in:inbox","max":10}'
```

The shell must have `LABELLER_ADMIN_TOKEN` set for this command; copying it into `.env` alone does not export it to your shell. Preview reads Gmail and runs the Agent, but does not change messages or the sync cursor. Agent runs may incur model costs.

Call `POST /api/sync` to initialize the history cursor and poll manually during local development. The first initialization starts from Gmail's current history, so existing messages need backfill.

## Labels and rules

Edit `labeller.config.ts`. Labels with a `description` are available to Jev. Rules run in declaration order; the first match wins and skips Jev. A rule with no actions also skips Jev and leaves the message unchanged.

```ts
import type { LabellerConfig } from './server/lib/labeller.ts'

export default {
  labels: {
    GitHub: { color: { textColor: '#ffffff', backgroundColor: '#4a86e8' } },
    Promotions: {
      description: 'Marketing, discounts, coupons, and campaigns',
      color: { textColor: '#666666', backgroundColor: '#efefef' },
    },
  },
  rules: {
    github: { from: 'notifications@github.com', label: 'GitHub' },
    promotions: { hasLabel: 'CATEGORY_PROMOTIONS', label: 'Promotions' },
  },
  cleanup: {
    promotions: { label: 'Promotions', olderThan: 14 },
  },
} satisfies LabellerConfig
```

Colors must come from [Gmail's label palette](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels). Descriptions guide Jev; Gmail does not store them. Label names with `/` form nested labels in Gmail.

Rule fields are `from`, `to`, `subject`, `body`, `listId`, `hasLabel`, `header`, and `not`. Text matches are case-insensitive substrings, or regular expressions written as `"/pattern/flags"`. A list matches any item; all specified fields must match. Regex state resets for every match, so `g` and `y` flags also work consistently across messages.

Actions are `label`, `archive`, `read`, `star`, and `trash`. The promotions rule uses Gmail's `CATEGORY_PROMOTIONS` system label across senders; messages without it fall through to Jev. The sample GitHub bot rule requests Trash, but takes effect only when `LABELLER_TRASH_ENABLED=true` and dry-run mode is off.

Cleanup moves old messages with the configured label to Trash, keeping starred messages. It runs at 04:00 UTC and requires `LABELLER_CLEANUP_ENABLED=true` and `LABELLER_DRY_RUN=false`. The rule Trash flag does not gate cleanup. Cleanup includes existing labelled mail, processes up to 500 matches per rule per run, and leaves further matches for later runs. Gmail permanently deletes messages in Trash after 30 days.

The app creates missing labels when applying decisions. Use the label setup CLI to preview and apply configured colors and visibility:

```sh
pnpm labels:sync
pnpm labels:sync --apply
```

It uses the same Executor URL, org-owned connection, and optional Access headers as the Worker. Unmanaged labels keep their current visibility. To also hide them from Gmail's sidebar, preview with `pnpm labels:sync --hide-unmanaged`, then apply with `pnpm labels:sync --apply --hide-unmanaged`. Hiding leaves labels attached to messages and searchable.

## Admin endpoints

All endpoints below require `Authorization: Bearer <VITEHUB_SECRET>`. Deployments that still use `LABELLER_ADMIN_TOKEN` can send that value instead.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/preview` | Read-only message preview. Accepts `query` and `max`, from 1 to 50. |
| `POST /api/sync` | Renew the watch if configured, then process messages since the saved cursor. |
| `POST /api/backfill` | Process one search page with `query`, `max` up to 100, and optional `pageToken`, or explicit `ids` up to 100. Returns `nextPageToken`. |
| `POST /api/cleanup` | Run cleanup now. Returns a preview while dry-run mode is on or cleanup is disabled. |

Pass `nextPageToken` back as `pageToken` until absent when backfilling. Every call decides messages again. Set `relabel: true` to also remove other managed labels. Dry-run backfill returns decisions without changing Gmail. Once you switch to live mode, run backfill again for messages you want to apply. Changing rules alone does not revisit earlier mail.

If your rules archive or trash messages, a live backfill can change the search results while you paginate. For bulk processing, collect message IDs first and submit them in batches of up to 100.

## Console and stored data

The ViteHub Console is available at `/_vitehub` during `pnpm dev` and at `https://email-labeller.onmax.me/_vitehub` in production through Cloudflare Access. Production Console invocation is enabled for the manual cleanup schedule. The production Worker does not store a SQL journal.

Run the stale-mail cleanup once from the project checkout with the ViteHub CLI:

```sh
pnpm exec vitehub schedule run cleanup --url https://email-labeller.onmax.me --json
```

The deployed Console URL must be reachable through Cloudflare Access. Set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` for a service token, or set `VITEHUB_CONSOLE_COOKIE` after signing in through the browser. The daily `0 4 * * *` Cloudflare schedule remains enabled for later runs.

KV stores only three entries: `gmail:history` with the history cursor and its sync timestamp, `gmail:watch-expiry` with the watch expiration, and `gmail:push-sync` with the time of the last push-triggered sync. Push notifications start at most one sync per minute, because every label change on an Inbox message, including the labeller's own, sends another push. The Worker does not store message contents or processing decisions. Unmatched email data, including up to 4,000 body characters, goes to Jev through Vercel AI Gateway. Executor handles Gmail credentials and operations.

## Cloudflare deployment

Create a KV namespace with `pnpm exec wrangler kv namespace create email-labeller`. Set these build-time values in `.env` or your build environment:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID. |
| `CLOUDFLARE_KV_NAMESPACE_ID` | ID returned when you create the KV namespace. |
| `CLOUDFLARE_WORKER_DOMAIN` | Optional custom domain; omit to use `workers.dev`. |

ViteHub selects the Cloudflare deployment preset and supplies Nitro's `cloudflare-module` output. `nitro.config.ts` does not repeat that preset, so the host is selected in one place. The Worker name comes from the fork's `package.json`; Cloudflare Workers Builds can override it with `WRANGLER_CI_OVERRIDE_NAME`.

`nitro.config.ts` copies only the listed nonsecret runtime settings from the build environment into Wrangler variables. Keep `LABELLER_DRY_RUN=true` and both Trash and cleanup flags `false` for the initial deployment. Executor URL and connection, and optional Pub/Sub settings must also be present when building.

```sh
pnpm build
pnpm typecheck

pnpm exec wrangler secret put EXECUTOR_API_KEY --config .output/server/wrangler.json
pnpm exec wrangler secret put AI_GATEWAY_API_KEY --config .output/server/wrangler.json
pnpm exec wrangler secret put VITEHUB_SECRET --config .output/server/wrangler.json
# Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET too if Executor requires them.
pnpm run deploy
```

`pnpm run deploy` rejects a build without a real account and KV namespace ID. A build without them still works for local development and preview. `pnpm preview` runs the built Worker locally. Local KV data stays on your machine and does not initialize the deployed namespace.

The build generates the KV binding and both Cron Triggers in `.output/server/wrangler.json`. Worker secrets are separate from local `.env`; their values do not enter the generated config. Rebuild after changing nonsecret variables. To apply labels after reviewing previews, set `LABELLER_DRY_RUN=false`, rebuild, and redeploy. Dry-run sync advances the history cursor, so use `POST /api/backfill` for earlier messages. Enable Trash and cleanup separately only after reviewing those rules.

There are no application database migrations. An existing D1 deployment starts with a fresh cursor when moved to KV. It leaves earlier mail for explicit backfill and does not import saved decisions.

### GitHub Actions

`.github/workflows/check.yml` runs build and typecheck on pull requests and pushes to `main`. It needs no application secrets.

Deployment is opt-in. Set the repository variable `DEPLOY_ENABLED=true`, the build-time variables listed above, and any nonsecret runtime variables from `.env.example`. Add a `CLOUDFLARE_API_TOKEN` repository secret with Workers Scripts, Workers Routes, and Workers KV Storage edit permissions for your account. The deployment workflow defaults to dry-run with Trash and cleanup disabled when their variables are absent.

`.github/workflows/deploy.yml` checks and deploys on pushes to `main` and manual runs. Create the KV namespace and configure application secrets before enabling it.

## Gmail push setup

Create a topic in the Google Cloud project associated with Executor's Gmail OAuth client. [Gmail requires the watch topic to belong to that project](https://developers.google.com/workspace/gmail/api/guides/push). Grant `gmail-api-push@system.gserviceaccount.com` permission to publish to it.

Create an authenticated Pub/Sub push subscription targeting `https://<your-domain>/gmail/push`, using a dedicated service account and that URL as its OIDC audience. Configure the Pub/Sub service agent and subscription creator with the permissions needed for [authenticated push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

Set these Worker variables:

```text
GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/<topic-name>
GMAIL_PUBSUB_SUBSCRIPTION=projects/<project-id>/subscriptions/<subscription-name>
PUBSUB_AUDIENCE=https://<your-domain>/gmail/push
PUBSUB_SERVICE_ACCOUNT=<push-account>@<project-id>.iam.gserviceaccount.com
```

The route verifies Google's JWT signature, issuer, audience, verified service-account email, subscription, and notification shape. It acknowledges the push and runs sync in the background. If that sync fails, polling retries from the saved cursor. The schedule renews the watch when it expires within a day and polls for missed notifications every five minutes. `POST /api/sync` can start the watch immediately.

## Verification and current limits

```sh
corepack pnpm build  # generates .vitehub/types for typecheck
corepack pnpm typecheck
```

This app manages one mailbox with best-effort processing. Sync calls in the same Worker isolate are coalesced, but other isolates and manual backfills can overlap. KV is eventually consistent and has no atomic lock. Concurrent or failed runs can repeat processing, overwrite a cursor with an older value, or call the model again with a different result. Label additions and removals are repeatable, but a new decision can add a different label. This template accepts those tradeoffs for a small mailbox.

The cursor advances only after the full batch succeeds, including in dry-run mode. A failed Gmail operation or cursor write leaves work for a later retry. No decision journal or replay endpoint is kept. Use backfill to revisit messages after changing rules or switching from dry-run to live mode.

When Gmail history expires, recovery searches Inbox messages received since the last saved sync timestamp, collects every page, then processes them before advancing the cursor. Initial setup starts from Gmail's current cursor. Imported older messages or messages outside Inbox can need explicit backfill.

The project uses a Nitro beta and the latest ViteHub package published through `pkg.pr.new`, locked in `pnpm-lock.yaml`. Use `pnpm build` and `pnpm typecheck` before deploying. After deployment, check `/api/health` and use `/api/preview` to verify your Executor connection and rules without changing Gmail.

## License

[MIT](LICENSE).
