// [LAW:single-enforcer] The ONE rule for "what counts as blank" when a stored text column
// becomes domain optionality. A null (a leftJoin miss / a human's empty vote), an empty
// string (a legacy sentinel), and a whitespace-only string ALL mean "nothing was said here" —
// a maker's placard, a critic's reasoning, a wisher's wish, and a lineage node's name are the
// SAME normalization, so they share this enforcer rather than each re-deciding what blank is
// (and drifting). The trim happens once, here. [LAW:one-source-of-truth]
export function blankToNull(text: string | null): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}
