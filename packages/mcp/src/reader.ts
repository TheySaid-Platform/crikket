import { getBugReportById } from "@crikket/bug-reports/procedures/get-bug-report"
import { getBugReportCaptureSource } from "@crikket/bug-reports/procedures/get-bug-report-capture"
import {
  getBugReportDebuggerEvents,
  getBugReportNetworkRequestDetails,
  getBugReportNetworkRequests,
} from "@crikket/bug-reports/procedures/get-bug-report-debugger"
import { listBugReports } from "@crikket/bug-reports/procedures/list-bug-reports"
import { call, type InferRouterInputs } from "@orpc/server"

import type { SessionContext } from "./types"

const readProcedures = {
  listReports: listBugReports,
  getReport: getBugReportById,
  getDebuggerEvents: getBugReportDebuggerEvents,
  getNetworkRequestsPage: getBugReportNetworkRequests,
  getNetworkRequestDetails: getBugReportNetworkRequestDetails,
  getCaptureSource: getBugReportCaptureSource,
}

type ReadInputs = InferRouterInputs<typeof readProcedures>

/**
 * Reads bug reports through the same oRPC procedures the web app uses, so
 * every access rule (organization scope, visibility, unready reports) is
 * applied in one place.
 */
export function createProcedureReader(session: SessionContext) {
  const options = { context: { session } }

  return {
    listReports: (input: ReadInputs["listReports"]) =>
      call(readProcedures.listReports, input, options),
    getReport: (id: string) => call(readProcedures.getReport, { id }, options),
    getDebuggerEvents: (id: string) =>
      call(readProcedures.getDebuggerEvents, { id }, options),
    getNetworkRequestsPage: (input: ReadInputs["getNetworkRequestsPage"]) =>
      call(readProcedures.getNetworkRequestsPage, input, options),
    getNetworkRequestDetails: (input: ReadInputs["getNetworkRequestDetails"]) =>
      call(readProcedures.getNetworkRequestDetails, input, options),
    getCaptureSource: (id: string) =>
      call(readProcedures.getCaptureSource, { id }, options),
  }
}

export type CrikketReader = ReturnType<typeof createProcedureReader>

export type BugReportDetails = Awaited<ReturnType<CrikketReader["getReport"]>>

export type BugReportListPage = Awaited<
  ReturnType<CrikketReader["listReports"]>
>

export type DebuggerEvents = Awaited<
  ReturnType<CrikketReader["getDebuggerEvents"]>
>

export type NetworkRequestsPage = Awaited<
  ReturnType<CrikketReader["getNetworkRequestsPage"]>
>

export type NetworkRequestItem = NetworkRequestsPage["items"][number]

export type NetworkRequestDetails = Awaited<
  ReturnType<CrikketReader["getNetworkRequestDetails"]>
>
