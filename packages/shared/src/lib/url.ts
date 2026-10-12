const TRAILING_SLASHES_PATTERN = /\/+$/

/** Joins a base URL and a path that starts with `/`, without a double slash. */
export function joinUrlPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(TRAILING_SLASHES_PATTERN, "")}${path}`
}
