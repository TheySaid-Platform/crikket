/**
 * Whether a key falls outside the per-organization cap. Keys are ranked
 * oldest first, with ties broken by id, so two creates racing each other agree
 * on which key is over the cap and exactly one of them backs out.
 */
export function isOverAccessKeyCap(input: {
  cap: number
  keyId: string
  keys: { id: string; createdAt: Date }[]
}): boolean {
  const ranked = [...input.keys].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  )
  const rank = ranked.findIndex((key) => key.id === input.keyId)
  return rank >= input.cap
}
