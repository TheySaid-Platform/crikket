import { buildPaginationMeta } from "@crikket/shared/lib/server/pagination"
import { ORPCError } from "@orpc/server"

import {
  countBugReportNetworkRequests,
  getBugReportDebuggerEventsData,
  getBugReportNetworkRequestDetails as getBugReportNetworkRequestDetailsData,
  getBugReportNetworkRequestPayload as getBugReportNetworkRequestPayloadData,
  getBugReportNetworkRequestsPage,
} from "../lib/debugger"
import {
  assertBugReportAccessById,
  bugReportIdInputSchema,
  debuggerNetworkRequestPayloadInputSchema,
  debuggerNetworkRequestsInputSchema,
  normalizeDebuggerNetworkRequestPagination,
} from "../lib/utils"
import { o } from "./context"

export const getBugReportDebuggerEvents = o
  .input(bugReportIdInputSchema)
  .handler(async ({ context, input }) => {
    await assertBugReportAccessById({
      id: input.id,
      session: context.session,
    })

    return getBugReportDebuggerEventsData(input.id)
  })

export const getBugReportNetworkRequests = o
  .input(debuggerNetworkRequestsInputSchema)
  .handler(async ({ context, input }) => {
    await assertBugReportAccessById({
      id: input.id,
      session: context.session,
    })

    const { page, perPage, offset, limit } =
      normalizeDebuggerNetworkRequestPagination({
        page: input.page,
        perPage: input.perPage,
      })

    const [totalCount, items] = await Promise.all([
      countBugReportNetworkRequests({
        bugReportId: input.id,
        search: input.search,
        tabId: input.tabId,
      }),
      getBugReportNetworkRequestsPage({
        bugReportId: input.id,
        limit,
        offset,
        search: input.search,
        tabId: input.tabId,
      }),
    ])

    return {
      items,
      pagination: buildPaginationMeta(totalCount, page, perPage),
    }
  })

export const getBugReportNetworkRequestPayload = o
  .input(debuggerNetworkRequestPayloadInputSchema)
  .handler(async ({ context, input }) => {
    await assertBugReportAccessById({
      id: input.id,
      session: context.session,
    })

    const payload = await getBugReportNetworkRequestPayloadData({
      bugReportId: input.id,
      requestId: input.requestId,
    })

    if (!payload) {
      throw new ORPCError("NOT_FOUND", { message: "Network request not found" })
    }

    return payload
  })

/**
 * One request with its headers and bodies. Used by the MCP server, which
 * needs a single request without paging through the whole list.
 */
export const getBugReportNetworkRequestDetails = o
  .input(debuggerNetworkRequestPayloadInputSchema)
  .handler(async ({ context, input }) => {
    await assertBugReportAccessById({
      id: input.id,
      session: context.session,
    })

    const details = await getBugReportNetworkRequestDetailsData({
      bugReportId: input.id,
      requestId: input.requestId,
    })

    if (!details) {
      throw new ORPCError("NOT_FOUND", { message: "Network request not found" })
    }

    return details
  })
