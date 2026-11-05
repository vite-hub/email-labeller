import type { LabellerOptions } from 'vite-hub/presets/labeller'

const github = 'notifications@github.com'

/**
 * Rules and label descriptions for the ViteHub labeller preset.
 * `pnpm labels:sync` applies label settings through the admin API.
 */
export default {
  // Gmail labels this app manages. A label with a description is available to Jev when no rule matches.
  // Colors must come from Gmail's label palette. Gmail itself stores no description.
  // Gmail sorts labels by name and nests `Parent/Child`.
  labels: {
    // GitHub labels are set by rules only.
    'GitHub': { color: { textColor: '#ffffff', backgroundColor: '#4a86e8' } },
    'GitHub/Bots': { color: { textColor: '#000000', backgroundColor: '#cccccc' } },

    'Work': {
      description: 'Work email from colleagues, clients, and company tools, plus partnership, sponsorship, and consulting requests about your projects',
      color: { textColor: '#000000', backgroundColor: '#fad165' },
    },
    'Jobs': {
      description: 'Job applications, recruiters, interviews, assessments, and freelance platforms, including their billing and account notices',
      color: { textColor: '#ffffff', backgroundColor: '#8e63ce' },
    },
    'Dev Services': {
      description: 'Developer tools and infrastructure: package publishes, deploys, SEO audits, usage, billing, and account notices',
      color: { textColor: '#000000', backgroundColor: '#ffad47' },
    },
    'Security': {
      description: 'Verification codes, sign-in links, sign-in and new device alerts, 2FA or password changes, and expiring tokens or keys',
      color: { textColor: '#ffffff', backgroundColor: '#fb4c2f' },
    },
    'Finance': {
      description: 'Account activity from banks, cards, and crypto exchanges: transfers, statements, taxes, and failed or upcoming payments. Not their promotions',
      color: { textColor: '#ffffff', backgroundColor: '#0b804b' },
    },
    'Orders': {
      description: 'Purchases, receipts, invoices, and package delivery tracking',
      color: { textColor: '#000000', backgroundColor: '#43d692' },
    },
    'Travel': {
      description: 'Flights, trains, hotels, visas, travel permits, and trip claims',
      color: { textColor: '#ffffff', backgroundColor: '#2da2bb' },
    },
    'Events': {
      description: 'Reservations, visits, and tickets outside travel, such as restaurants, meetups, conferences, webinars, and research or study sessions, plus their invitations and follow-ups',
      color: { textColor: '#ffffff', backgroundColor: '#e07798' },
    },
    'Newsletters': {
      description: 'Newsletters, digests, and product update emails worth reading',
      color: { textColor: '#000000', backgroundColor: '#c9daf8' },
    },
    'Promotions': {
      description: 'Marketing, promotions, discounts, coupons, campaigns, and win-back emails, including from banks, crypto exchanges, and services you use',
      color: { textColor: '#666666', backgroundColor: '#efefef' },
    },
    'Accounts': {
      description: 'Account notices from everyday apps and Google: storage almost full, data exports, welcome and sign-up emails, profile or business listing reports, and inactive-account warnings. Not security alerts or developer tools',
      color: { textColor: '#ffffff', backgroundColor: '#999999' },
    },
    'Personal': {
      description: 'Friends and family, including things they forward, notes to self, classes and courses you take, clubs and memberships, housing queues and rent, and government or tax matters',
      color: { textColor: '#000000', backgroundColor: '#b99aff' },
    },
  },

  // Rules run in order and the first match wins. A matching rule skips Jev.
  // Text matches are case-insensitive substrings, or a regular expression written as "/pattern/flags".
  // A list matches when any item matches. All fields of a rule must match.
  rules: {
    // Deletes GitHub bot notifications: replies and pushes on issues and pull requests by `[bot]` accounts.
    // The From address is always notifications@github.com; the sender header names the bot.
    // Needs LABELLER_TRASH_ENABLED=true. Trash keeps them for 30 days.
    deleteGithubBots: {
      from: github,
      subject: '/^Re:/i',
      header: { 'x-github-sender': '/\\[bot\\]$/i' },
      label: 'GitHub/Bots',
      trash: true,
    },
    github: { from: github, label: 'GitHub' },
    npmPublish: { from: 'support@npmjs.com', subject: '/^Successfully published/i', label: 'Dev Services' },
    npmStage: { from: 'support@npmjs.com', subject: '/^Successfully staged/i', label: 'Dev Services' },
    // Uses Gmail's category across senders. Other messages fall through to Jev.
    promotions: { hasLabel: 'CATEGORY_PROMOTIONS', label: 'Promotions' },
  },

  // Moves old messages to Trash once a day. Starred messages are kept. Inactive until LABELLER_CLEANUP_ENABLED=true and LABELLER_DRY_RUN=false.
  cleanup: {
    promotions: { label: 'Promotions', olderThan: 14 },
    security: { label: 'Security', olderThan: 30 },
  },
} satisfies Pick<LabellerOptions, 'labels' | 'rules' | 'cleanup'>
