/**
 * Reads the organization a key was created for. The plugin stores metadata
 * as JSON text, and older plugin versions stringified it twice.
 */
export function readAccessKeyOrganizationId(metadata: unknown): string | null {
  let value = metadata
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }

  if (typeof value !== "object" || value === null) {
    return null
  }

  const organizationId = (value as { organizationId?: unknown }).organizationId
  return typeof organizationId === "string" && organizationId.length > 0
    ? organizationId
    : null
}
