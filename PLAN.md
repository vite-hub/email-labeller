# Email classifier template: planning draft

This is the original design draft. The current implementation and setup status are in `README.md`. Gmail Pub/Sub push and the ViteHub schedule are both active. Trash rules are configured but disabled by `LABELLER_TRASH_ENABLED=false`.

## Proposed flow

Build a Nitro application that connects to Gmail. Gmail `watch` publishes mailbox changes to Google Pub/Sub. A Pub/Sub push subscription calls a Nitro webhook. The webhook verifies the request, records a durable synchronization request, and acknowledges it. A worker reads Gmail history from a stored cursor, fetches messages, runs deterministic rules, and invokes a ViteHub model Agent for unresolved messages. Application code validates the Agent result, then adds a Gmail label or moves an individual message to Trash.

Deployment choices: use the existing Google Cloud project `maxios-gog-mg-20260802` (MaxiOS), the signed-in Google account, and the existing Executor Gmail connection `personalGmail` for this personal deployment. Nitro will call Executor for Gmail operations. It does not need a separate Google OAuth web client or a Google callback URL for Gmail. The reusable template can keep a direct Gmail OAuth adapter as an alternative. Gmail API is already enabled in MaxiOS. Cloudflare DNS and the Pub/Sub push URL still depend on the Nitro deployment target.

Cloud setup completed for the personal deployment: the Pub/Sub topic `projects/maxios-gog-mg-20260802/topics/email-labeller-gmail` exists, and `gmail-api-push@system.gserviceaccount.com` has `roles/pubsub.publisher` on that topic. The service account `email-labeller-push@maxios-gog-mg-20260802.iam.gserviceaccount.com` signs authenticated Pub/Sub push deliveries to `https://email-labeller.onmax.me/gmail/push`. The Cloudflare Worker, D1 database, custom domain, and hourly Cron Trigger are deployed. Gmail watch is active, and its first notification was recorded in D1. `LABELLER_DRY_RUN=false` enables label changes for new Inbox messages; no current rule sends mail to Trash.

Executor is running at `executor.onmax.me` on this machine and already has a connected Gmail account named `personalGmail`. A read-only `users.getProfile(me)` call returned HTTP 200. Its Gmail tool catalog includes labels, message modification, history, and watch operations. Executor encrypts connection credentials in its database; it is not a general `.env` store for the Nitro process. A dedicated user key named `Email Labeller Nitro` has been created and stored outside the repository at `/home/maxi/.config/email-labeller/executor-api-key` (directory mode `700`, file mode `600`). A local Executor API request using the key returned HTTP 200. The future Nitro process must load this key into server-only Env. Self-hosted Executor keys belong to a user and are not narrowed to this Gmail connection, so this key needs a clear process boundary and can be revoked by name in Executor.

```text
Gmail watch -> Pub/Sub -> Nitro webhook -> durable sync request
  -> Gmail history -> message -> ordered rules
  -> unresolved -> ViteHub Agent Channel -> model decision
  -> server validation -> Gmail modify/trash -> audit record
```

The model does not get Gmail credentials or an editing tool. `trash` means moving a message to Trash, not permanent deletion. The template acts on messages rather than entire Gmail threads. Dry-run mode records the proposed action without changing the mailbox.

## Webhook and scheduled maintenance

The webhook is the primary event path. A Gmail notification contains an email address and `historyId`; it does not contain the message. The worker calls `history.list` using the previous stored cursor and fetches the relevant messages. Notifications may overlap, arrive late, or be dropped. Processing therefore needs a per-account synchronization lock, idempotent message records, and a recovery path.

Gmail requires renewing `watch` at least every seven days and recommends once a day. A scheduled maintenance task renews the watch and reconciles accounts that have been quiet for too long. The webhook replaces frequent polling, but not this maintenance task. A single-process Schedule driver fits one persistent Node server; a multi-replica or serverless deployment needs a host-owned wake and distributed lock.

The Pub/Sub push subscription should use authenticated push. The Nitro route verifies the OIDC JWT signature, audience, and expected service-account identity, then checks the subscription and connected mailbox. It returns success only after it has durably recorded the sync request, since a successful HTTP response acknowledges the Pub/Sub delivery.

## ViteHub and application responsibilities

| Need | ViteHub today | Work for this template |
| --- | --- | --- |
| Model classification | Model-backed Agent, custom Channel, structured output | Prompt, label allowlist, confidence policy, model evaluation |
| Incoming email | No Gmail inbox adapter | Executor Gmail connection for this deployment; Pub/Sub verification, history, message fetch |
| Mailbox edits | No inbox edit API in `Email` | Executor Gmail `labels`, `messages.modify`, and `messages.trash` tools |
| Configuration | Server Env | Executor API key and Pub/Sub configuration; Executor owns the Gmail OAuth token |
| Durable state | Database and optional Workflow | Cursor, idempotency, decisions, retries, audit trail |
| Maintenance | Schedule | Watch renewal and missed-notification reconciliation |

The current `@vite-hub/email` package is outbound only. `EmailClient` exposes `send()`. Its Resend driver calls Resend's HTTP API directly, and its Cloudflare driver uses an outbound email binding. There is no underlying inbox SDK that can edit Gmail messages. The Agent `email_send` Capability is also outbound only.

If ViteHub productizes Gmail support, a separate optional mailbox integration or package is a cleaner boundary than adding Gmail-specific operations to the outbound `EmailClient`. It could expose account connections, normalized message reads, label operations, watch lifecycle, and provider event verification. The initial template can own this adapter until a reusable contract is proven.

## Model decision pending

The requested model is “Jev”; the exact AI SDK provider and model ID are pending. ViteHub's Agent Driver accepts an AI SDK `LanguageModel` object directly. Its string model IDs use AI Gateway. Once the provider and ID are known, the plan is to instantiate the provider model in application code and test structured output through ViteHub. If the model is also available in AI Gateway, a string ID may be simpler.

`pnpm patch` is reserved for a reproduced gap in a third-party dependency, such as a provider adapter failing to expose the model or structured output. A missing ViteHub feature should be changed in ViteHub source. No patch is planned before identifying an actual failure.

## Configuration and safety

- Start with the existing Executor Gmail connection `personalGmail`. Executor retains and refreshes its Google OAuth credentials. Keep the Nitro application's Executor API key in server-only host Env, never in the browser or model.
- Load all existing Gmail labels for configuration. Store IDs and display current names. Only a selected subset of user labels is available to the model; exclude system and deleted labels.
- Keep ordered, versioned rules for sender, recipient, domain, subject, and actions `addLabel`, `trash`, or `ignore`. Normalize message headers before matching.
- Store a unique processing record for `(accountId, gmailMessageId)`, with rule and classifier versions as metadata. Reclassification after rules change is explicit.
- Advance the Gmail history cursor only after the batch is safely recorded. Handle expired cursors with bounded resynchronization.
- For low confidence, invalid model output, or a label outside the allowlist, leave the message unchanged and mark it for review.
- Evaluate the classifier on a consented, redacted set of messages before enabling automatic changes.

## Illustrative file layout

```text
vite.config.ts                         # Nitro, ViteHub, Server Env
server/agents/classifier.ts            # model Driver, structured output, Gmail Channel
server/api/gmail/notifications.post.ts # authenticated Pub/Sub push endpoint
server/schedules/gmail-maintenance.ts  # watch renewal and reconciliation
server/lib/gmail.ts                     # Executor Gmail adapter: history, messages, labels, changes
server/lib/rules.ts                     # deterministic rule evaluator
server/lib/process-message.ts           # policy and orchestration
server/lib/state.ts                     # cursor, lock, idempotency, audit log
```

The code shape is:

```ts
// Agent definition, once the model provider is specified
defineAgent({
  channels: { gmail: defineChannel('gmail', { /* mail.received trigger */ }) },
  driver: {
    model: createRequestedModel(), // AI SDK LanguageModel
    output: { schema: classificationSchema },
  },
})

// The application, not the model, applies effects
const rule = matchRule(message, rules)
const decision = rule ?? await classifyWithAgent(message, allowedLabels)
const checked = validateDecision(decision, allowedLabels, policy)
await recordAndApplyGmailAction(message.id, checked)
```

## Delivery stages

1. Connect one mailbox, import labels, define rules, and display dry-run decisions.
2. Add authenticated Pub/Sub push, Gmail history synchronization, a durable cursor, and idempotency. Enable automatic label changes after validation.
3. Enable Trash for explicit rules, add review and reversal, and measure classification accuracy.
4. Add watch renewal, missed-notification recovery, and deployment-specific scaling controls.

## Evidence

- [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push): Pub/Sub push, history IDs, watch renewal, notification loss and recovery.
- [Authenticated Pub/Sub push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions): OIDC JWT verification.
- [Gmail message label changes](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify) and [Trash](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/trash).
- [ViteHub Agent Drivers](https://vitehub.dev/docs/agents/agent-drivers/) and [ViteHub Email](https://vitehub.dev/docs/server-primitives/email/).
