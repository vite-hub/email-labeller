<h1>
  <img src="./.github/banner.svg" alt="Email labeller: labels new Gmail with your rules first and Jev for the rest" width="100%">
</h1>

[![Built with ViteHub](https://comark-ui.onmax.me/badge.svg?label=built%20with&value=ViteHub&icon=package)](https://vitehub.dev)
[![Check](https://comark-ui.onmax.me/badge.svg?source=github-actions&repository=vite-hub%2Femail-labeller&workflow=check.yml&icon=github)](https://github.com/vite-hub/email-labeller/actions/workflows/check.yml)
[![version](https://comark-ui.onmax.me/badge.svg?label=version&value=0.1.0)](./package.json)
[![license: MIT](https://comark-ui.onmax.me/badge.svg?label=license&value=MIT)](./LICENSE)

Email labeller labels new Gmail Inbox messages from a Cloudflare Worker. Your rules run first. When no rule matches, TypeSafe's Jev model picks one of your labels from its description. Rules can also archive, mark as read, star, or trash, and a daily cleanup trashes old labelled mail. It starts in dry-run mode and changes nothing until you turn that off.

[How it works](#how-it-works) · [Setup](#setup) · [Labels and rules](#labels-and-rules) · [Deploy](#deploy) · [Admin API](#admin-api) · [ViteHub](https://vitehub.dev)

An independent project by [@onmax](https://github.com/onmax), built on [ViteHub](https://vitehub.dev).

## How it works

```text
Gmail watch -> Pub/Sub -> POST /gmail/push ─┐
Cron every 5 minutes ───────────────────────┴─> sync Gmail history
  -> first matching rule, or Jev when none matches
  -> apply labels and actions (live mode only) -> save the history cursor in KV
Cron daily at 04:00 UTC -> trash labelled mail older than its cleanup age
```

Gmail access goes through [Executor](https://github.com/UsefulSoftwareCo/executor), which holds and refreshes the Google OAuth credential. Jev runs through Vercel AI Gateway and sees mail only when no rule matches, with at most 4,000 body characters. The Worker stores only its sync state in KV, never message contents or decisions.

## Setup

You need Node.js 24.15+, pnpm, an Executor instance with an org-owned Gmail connection, a Vercel AI Gateway key with access to `typesafe-ai/jev`, and a Cloudflare account.

```sh
corepack pnpm install --frozen-lockfile
cp .env.example .env   # every variable is described there
corepack pnpm dev
```

Preview what it would do to your Inbox without changing anything. Use the port Vite prints:

```sh
curl -X POST http://localhost:5173/api/preview \
  -H "authorization: Bearer $VITEHUB_SECRET" -H 'content-type: application/json' \
  -d '{"query":"in:inbox","max":10}'
```

## Labels and rules

Everything the labeller does lives in [`labeller.config.ts`](./labeller.config.ts):

```ts
export default {
  labels: {
    GitHub: { color: { textColor: '#ffffff', backgroundColor: '#4a86e8' } },
    Promotions: {
      description: 'Marketing, discounts, coupons, and campaigns', // Jev can pick labels with a description
      color: { textColor: '#666666', backgroundColor: '#efefef' },
    },
  },
  rules: {
    github: { from: 'notifications@github.com', label: 'GitHub' },
    promotions: { hasLabel: 'CATEGORY_PROMOTIONS', label: 'Promotions' },
  },
  cleanup: {
    promotions: { label: 'Promotions', olderThan: 14 }, // days
  },
} satisfies LabellerConfig
```

- **Rules** run in order and the first match wins. A rule matches on `from`, `to`, `subject`, `body`, `listId`, `hasLabel`, `header`, and `not`. Text matches are case-insensitive substrings, or regular expressions written as `"/pattern/flags"`. A list matches any of its items.
- **Actions** are `label`, `archive`, `read`, `star`, and `trash`. A rule with no actions leaves the message alone and skips Jev.
- **Colors** must come from [Gmail's label palette](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels). `Parent/Child` names nest in Gmail.
- **Cleanup** keeps starred mail and trashes up to 500 messages per rule per run.

`pnpm labels:sync` previews label colors and visibility, `--apply` writes them, and `--hide-unmanaged` hides every other label from the sidebar.

Three switches gate changes to Gmail, and each starts off: `LABELLER_DRY_RUN=false` applies decisions, `LABELLER_TRASH_ENABLED=true` lets rules trash, and `LABELLER_CLEANUP_ENABLED=true` runs the daily cleanup.

## Deploy

Create a KV namespace, then put `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_KV_NAMESPACE_ID`, and optionally `CLOUDFLARE_WORKER_DOMAIN` in `.env`:

```sh
pnpm exec wrangler kv namespace create email-labeller
pnpm build
pnpm exec wrangler secret put EXECUTOR_API_KEY --config .output/server/wrangler.json
pnpm exec wrangler secret put AI_GATEWAY_API_KEY --config .output/server/wrangler.json
pnpm exec wrangler secret put VITEHUB_SECRET --config .output/server/wrangler.json
pnpm run deploy
```

Non-secret settings are read at build time, so rebuild and redeploy after changing them. To deploy from GitHub Actions on every push to `main`, set the repository variable `DEPLOY_ENABLED=true`, the same variables, and a `CLOUDFLARE_API_TOKEN` secret.

**Instant delivery (optional).** Without it the Worker polls every five minutes. To react right away, create a Pub/Sub topic in the Google Cloud project of Executor's Gmail OAuth client, let `gmail-api-push@system.gserviceaccount.com` publish to it, and add an [authenticated push subscription](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions) to `https://<your-domain>/gmail/push`. Then set `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION`, `PUBSUB_AUDIENCE`, and `PUBSUB_SERVICE_ACCOUNT`. The Worker verifies each push's Google-signed token.

## Admin API

Every endpoint takes `Authorization: Bearer <VITEHUB_SECRET>`.

| Endpoint | What it does |
| --- | --- |
| `GET /api/health` | Sync status. Returns 503 after two failed syncs in a row. With the token, it also shows the last error and the skipped messages. Works without the token too. |
| `POST /api/preview` | Decides up to 50 messages from a Gmail `query` without changing anything. |
| `POST /api/sync` | Processes new mail since the saved cursor. Call again while it returns `"more": true`. |
| `POST /api/backfill` | Processes one search page (`query`, `max` up to 100, `pageToken`) or a list of `ids`. Add `relabel: true` to remove other managed labels. |
| `POST /api/cleanup` | Runs cleanup now. Returns a preview while dry-run mode is on or cleanup is off. |

The ViteHub Console is at `/_vitehub`. In production, put it behind Cloudflare Access with `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.

## Limits

It's built for one mailbox. Overlapping syncs can process a message twice, because KV has no lock. A message that fails three times is skipped and listed in `/api/health`; backfill its ID to retry. Changing rules doesn't revisit old mail, so backfill it. The project pins a Nitro beta and a ViteHub preview build, locked in `pnpm-lock.yaml`.

## License

[MIT](./LICENSE)
