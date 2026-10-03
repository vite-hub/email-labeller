import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import config from '../labeller.config.ts'
import { type Email, jevLabels, matchRule, matches } from '../server/lib/labeller.ts'

function email(overrides: Partial<Email> = {}): Email {
  return {
    id: 'm1',
    threadId: 't1',
    from: 'Someone <someone@example.com>',
    to: ['me@example.com'],
    subject: 'Hello',
    snippet: '',
    body: '',
    listId: '',
    labels: ['INBOX', 'UNREAD'],
    headers: {},
    ...overrides,
  }
}

describe('matches', () => {
  it('matches case-insensitive substrings', () => {
    assert.equal(matches(email({ subject: 'Your Invoice' }), { subject: 'invoice' }), true)
    assert.equal(matches(email({ subject: 'Your Invoice' }), { subject: 'receipt' }), false)
  })

  it('matches `/pattern/flags` as a regular expression', () => {
    assert.equal(matches(email({ subject: 'Re: fix' }), { subject: '/^re:/i' }), true)
    assert.equal(matches(email({ subject: 'About Re: fix' }), { subject: '/^re:/i' }), false)
  })

  it('matches any item of a list and every field of a rule', () => {
    assert.equal(matches(email({ from: 'a@x.com' }), { from: ['b@x.com', 'a@x.com'] }), true)
    assert.equal(matches(email({ from: 'a@x.com', subject: 'Hi' }), { from: 'a@x.com', subject: 'Bye' }), false)
  })

  it('matches To, Cc, and Delivered-To values', () => {
    assert.equal(matches(email({ to: ['team@x.com', 'me@y.com'] }), { to: 'me@y.com' }), true)
  })

  it('reads headers by lowercase name', () => {
    assert.equal(matches(email({ headers: { 'x-github-sender': 'renovate[bot]' } }), { header: { 'X-GitHub-Sender': '[bot]' } }), true)
    assert.equal(matches(email(), { header: { 'x-github-sender': '[bot]' } }), false)
  })

  it('falls back to the snippet when the body is empty', () => {
    assert.equal(matches(email({ snippet: 'Your code is 123' }), { body: 'your code' }), true)
  })

  it('inverts a nested match with `not`', () => {
    assert.equal(matches(email({ from: 'a@x.com' }), { from: '@x.com', not: { from: 'a@' } }), false)
    assert.equal(matches(email({ from: 'b@x.com' }), { from: '@x.com', not: { from: 'a@' } }), true)
  })
})

describe('matchRule', () => {
  it('returns the first matching rule with its Gmail changes', () => {
    const decision = matchRule(email({ from: 'a@x.com' }), {
      first: { from: 'a@x.com', label: ['One', 'Two'], archive: true, read: true, star: true },
      second: { from: 'a@x.com', label: 'Never' },
    })
    assert.deepEqual(decision, { rule: 'first', add: ['One', 'Two', 'STARRED'], remove: ['INBOX', 'UNREAD'], trash: false })
  })

  it('returns undefined when no rule matches, so Jev decides', () => {
    assert.equal(matchRule(email(), { other: { from: 'nobody@x.com', label: 'X' } }), undefined)
  })
})

describe('labeller.config.ts', () => {
  const github = (subject: string, sender: string) => email({
    from: 'Someone <notifications@github.com>',
    subject,
    headers: { 'x-github-sender': sender },
  })

  it('labels and trashes GitHub bot replies', () => {
    assert.deepEqual(matchRule(github('Re: [vite-hub/vitehub] Fix (PR #1)', 'pullfrog[bot]'), config.rules), {
      rule: 'deleteGithubBots',
      add: ['GitHub/Bots'],
      remove: [],
      trash: true,
    })
  })

  it('keeps GitHub notifications from people', () => {
    const decision = matchRule(github('Re: [vite-hub/vitehub] Fix (PR #1)', 'onmax'), config.rules)
    assert.equal(decision?.rule, 'github')
    assert.equal(decision?.trash, false)
  })

  it('does not trash new GitHub threads opened by bots', () => {
    assert.equal(matchRule(github('[vite-hub/vitehub] chore(deps): update', 'renovate[bot]'), config.rules)?.rule, 'github')
  })

  it('only uses rule labels that the config manages', () => {
    for (const [name, rule] of Object.entries(config.rules)) {
      for (const label of rule.label === undefined ? [] : [rule.label].flat()) {
        assert.ok(Object.hasOwn(config.labels, label), `${name} uses unmanaged label ${label}`)
      }
    }
  })

  it('only cleans up labels that the config manages', () => {
    for (const [name, rule] of Object.entries(config.cleanup ?? {})) {
      assert.ok(Object.hasOwn(config.labels, rule.label), `${name} cleans up unmanaged label ${rule.label}`)
    }
  })

  it('gives Jev at least one label with a description', () => {
    assert.ok(Object.keys(jevLabels(config.labels)).length > 0)
  })
})
