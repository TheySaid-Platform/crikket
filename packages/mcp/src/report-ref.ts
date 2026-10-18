import { joinUrlPath } from "@crikket/shared/lib/url"

const REPORT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const SHARE_PATH_PATTERN = /^\/s\/([A-Za-z0-9_-]{1,64})\/?$/
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

export type ReportRefResult =
  | { ok: true; id: string }
  | { ok: false; message: string }

/**
 * Accepts either a bug report id (`gVQoTvqv0vRo`) or a share link
 * (`https://app.crikket.io/s/gVQoTvqv0vRo`, with or without the scheme).
 */
export function parseReportRef(value: string): ReportRefResult {
  const input = value.trim()

  if (REPORT_ID_PATTERN.test(input)) {
    return { ok: true, id: input }
  }

  const candidate = URL_SCHEME_PATTERN.test(input) ? input : `https://${input}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return invalidReportRef(value)
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return invalidReportRef(value)
  }

  const id = SHARE_PATH_PATTERN.exec(url.pathname)?.[1]
  return id ? { ok: true, id } : invalidReportRef(value)
}

function invalidReportRef(value: string): ReportRefResult {
  return {
    ok: false,
    message: `"${value.slice(0, 200)}" is not a bug report id or a Crikket share link (…/s/<id>).`,
  }
}

export function buildShareUrl(appOrigin: string, id: string): string {
  return joinUrlPath(appOrigin, `/s/${id}`)
}
