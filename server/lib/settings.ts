import * as v from 'valibot'

const boolean = (fallback: 'true' | 'false') => v.pipe(v.optional(v.picklist(['true', 'false']), fallback), v.transform(value => value === 'true'))

// Workers exposes bindings through process.env with nodejs_compat and this app's compatibility date.
export const settings = v.parse(v.object({
  LABELLER_DRY_RUN: boolean('true'),
  LABELLER_TRASH_ENABLED: boolean('false'),
  LABELLER_CLEANUP_ENABLED: boolean('false'),
  LABELLER_MIN_CONFIDENCE: v.pipe(v.optional(v.string(), '0.6'), v.transform(Number), v.number(), v.minValue(0), v.maxValue(1)),
}), process.env)
