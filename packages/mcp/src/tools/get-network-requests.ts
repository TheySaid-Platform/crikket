import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import {
  clampInteger,
  isFailedNetworkRequest,
  pagedResult,
  truncateText,
} from "../format"
import { describeMissingRequests, fetchAllNetworkRequests } from "../network"
import {
  buildNetworkRequestFilter,
  parseStatusFilter,
} from "../network-filters"
import type { CrikketReader, NetworkRequestItem } from "../reader"
import { toNetworkItem } from "../views"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
  ToolInputError,
} from "./shared"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
/** Capture keeps at most 4,000 characters of a body. */
export const INLINE_BODY_MAX_CHARS = 2000

const BODY_MODES = ["none", "errors", "all"] as const
type BodyMode = (typeof BODY_MODES)[number]

const stringList = (description: string) =>
  z
    .array(z.string().trim().min(1).max(200))
    .max(20)
    .optional()
    .describe(description)

export function registerGetNetworkRequestsTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_network_requests",
    {
      title: "Get network requests",
      description:
        'Get the network requests captured with a bug report, in time order: method, URL, status, failure reason, duration and time (offsetMs, ms from the start of the video). Filters combine with AND; values inside one filter combine with OR. Bodies of failed requests are included by default (bodies: "errors"); get_network_request_details has the headers.',
      inputSchema: {
        report: reportInputSchema,
        failedOnly: z
          .boolean()
          .optional()
          .describe(
            "Only failed requests: status 0, 400 or above, or a network failure."
          ),
        statusCodes: stringList(
          'Status classes or codes, e.g. ["4xx", "5xx"] or ["404", "500"].'
        ),
        methods: stringList('HTTP methods, e.g. ["POST", "PUT"].'),
        hosts: stringList(
          'Host names, e.g. ["api.example.com"]; "example.com" also matches its subdomains.'
        ),
        contentTypes: stringList(
          'Parts of the response content type, e.g. ["json"] or ["text/html"].'
        ),
        search: z
          .string()
          .max(200)
          .optional()
          .describe(
            "Only requests whose method, URL or status contains this text."
          ),
        tabId: z.number().int().min(0).optional().describe("Only this tab."),
        bodies: z
          .enum(BODY_MODES)
          .optional()
          .describe(
            `Include request and response bodies (cut to ${INLINE_BODY_MAX_CHARS} characters): "errors" for failed requests only (default), "all", or "none".`
          ),
        offset: z.number().int().min(0).optional().describe("Default: 0."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Default: ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      runTool("get_network_requests", async () => {
        const id = resolveReportId(input.report)
        const status = input.statusCodes?.length
          ? parseStatusFilter(input.statusCodes)
          : null
        if (status && !status.ok) {
          throw new ToolInputError(
            `Not a status class or code: ${status.invalid.join(", ")}. Use values like "4xx" or "404".`
          )
        }

        const requests = await fetchAllNetworkRequests(deps.reader, {
          id,
          search: input.search?.trim() || undefined,
          tabId: input.tabId,
        })
        const matching = requests.items.filter(
          buildNetworkRequestFilter(input, status?.matches ?? null)
        )
        const offset = input.offset ?? 0
        const limit = clampInteger(input.limit, {
          min: 1,
          max: MAX_LIMIT,
          fallback: DEFAULT_LIMIT,
        })
        const items = await withBodies(deps.reader, {
          id,
          mode: input.bodies ?? "errors",
          page: matching.slice(offset, offset + limit),
        })
        const missing = describeMissingRequests(requests)

        return pagedResult({
          total: matching.length,
          extra: {
            failedTotal: requests.items.filter(isFailedNetworkRequest).length,
            ...(missing ? { warning: missing } : {}),
          },
          offset,
          items,
        })
      })
  )
}

/** Adds bodies to the requests on this page, in one query. */
export async function withBodies(
  reader: CrikketReader,
  input: {
    id: string
    mode: BodyMode
    page: NetworkRequestItem[]
    maxChars?: number
  }
) {
  const maxChars = input.maxChars ?? INLINE_BODY_MAX_CHARS
  const wanted =
    input.mode === "none"
      ? []
      : input.page.filter(
          (request) => input.mode === "all" || isFailedNetworkRequest(request)
        )
  const bodies = wanted.length
    ? await reader.getNetworkRequestBodies({
        id: input.id,
        requestIds: wanted.map((request) => request.id),
      })
    : {}

  return input.page.map((request) => {
    const body = bodies[request.id]
    return {
      ...toNetworkItem(request),
      ...(body
        ? {
            requestBody: truncateText(body.requestBody, maxChars),
            responseBody: truncateText(body.responseBody, maxChars),
          }
        : {}),
    }
  })
}
