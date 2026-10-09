import * as v from 'valibot'

/** A Gmail message, normalized for rules and Jev. */
export const emailSchema = v.object({
  id: v.string(),
  threadId: v.string(),
  /** Raw `From` header, for example `GitHub <notifications@github.com>`. */
  from: v.string(),
  /** `To`, `Cc`, and `Delivered-To` headers. */
  to: v.array(v.string()),
  subject: v.string(),
  snippet: v.string(),
  /** Plain-text body, truncated. */
  body: v.string(),
  /** `List-Id` header, when present. */
  listId: v.string(),
  /** Names of the labels already on the message, including system labels such as `INBOX`. */
  labels: v.array(v.string()),
  /** All headers, with lowercase names. */
  headers: v.record(v.string(), v.string()),
})

export type Email = v.InferOutput<typeof emailSchema>

/** A case-insensitive substring, or a regular expression written as `/pattern/flags`. A list matches any item. */
type Text = string | readonly string[]

export interface Match {
  from?: Text
  to?: Text
  subject?: Text
  body?: Text
  listId?: Text
  /** Matches a label already on the message. */
  hasLabel?: Text
  /** Matches header values by lowercase header name. */
  header?: Readonly<Record<string, Text>>
  /** Matches when this nested match does not. */
  not?: Match
}

export interface Rule extends Match {
  /** Label names to add. Missing labels are created. */
  label?: Text
  /** Remove from Inbox. */
  archive?: boolean
  /** Mark as read. */
  read?: boolean
  star?: boolean
  /** Move to Trash. Gmail deletes it after 30 days. */
  trash?: boolean
}

export interface LabelSettings {
  /** Makes the label available to Jev when no rule matches. Gmail has no label description field. */
  description?: string
  /** A color from Gmail's label palette. */
  color: { textColor: string, backgroundColor: string }
}

export interface CleanupRule {
  /** Label name. Starred messages are kept. */
  label: string
  /** Moves messages with this label to Trash after this many days. */
  olderThan: number
}

/** The `labeller.config.ts` shape. */
export interface LabellerConfig {
  /** Gmail labels this app manages. `pnpm labels:sync` creates them and applies the colors. */
  labels: Readonly<Record<string, LabelSettings>>
  /** Runs in order for each new Inbox message. The first match wins and skips Jev. */
  rules: Readonly<Record<string, Rule>>
  /** Moves old messages to Trash by label when cleanup is enabled and dry-run mode is off. */
  cleanup?: Readonly<Record<string, CleanupRule>>
}

/** Label names and descriptions Jev may choose from. */
export function jevLabels(labels: LabellerConfig['labels']): Record<string, string> {
  return Object.fromEntries(Object.entries(labels).flatMap(([name, label]) =>
    label.description ? [[name, label.description]] : []))
}

/** The rule that matched an email, returned by the labeller Agent instead of running Jev. */
export interface RuleDecision {
  rule: string
  add: string[]
  remove: string[]
  trash: boolean
}

const patterns = new Map<string, (value: string) => boolean>()

function compile(pattern: string): (value: string) => boolean {
  let test = patterns.get(pattern)
  if (!test) {
    const regex = /^\/(.+)\/([a-z]*)$/.exec(pattern)
    if (regex) {
      const expression = new RegExp(regex[1], regex[2])
      test = (value) => {
        expression.lastIndex = 0
        return expression.test(value)
      }
    }
    else {
      const needle = pattern.toLowerCase()
      test = value => value.toLowerCase().includes(needle)
    }
    patterns.set(pattern, test)
  }
  return test
}

function matchText(values: string | string[], text: Text | undefined): boolean {
  if (text === undefined) return true
  const list = typeof text === 'string' ? [text] : text
  return [values].flat().some(value => list.some(pattern => compile(pattern)(value)))
}

export function matches(email: Email, match: Match): boolean {
  return matchText(email.from, match.from)
    && matchText(email.to, match.to)
    && matchText(email.subject, match.subject)
    && matchText(email.body || email.snippet, match.body)
    && matchText(email.listId, match.listId)
    && matchText(email.labels, match.hasLabel)
    && Object.entries(match.header ?? {}).every(([name, text]) => matchText(email.headers[name.toLowerCase()] ?? '', text))
    && (!match.not || !matches(email, match.not))
}

/** Returns the first matching rule's changes, or `undefined` when Jev should decide. */
export function matchRule(email: Email, rules: Readonly<Record<string, Rule>>): RuleDecision | undefined {
  for (const [name, rule] of Object.entries(rules)) {
    if (!matches(email, rule)) continue
    const add = rule.label === undefined ? [] : [rule.label].flat()
    if (rule.star) add.push('STARRED')
    const remove = [...rule.archive ? ['INBOX'] : [], ...rule.read ? ['UNREAD'] : []]
    return { rule: name, add, remove, trash: rule.trash === true }
  }
}
