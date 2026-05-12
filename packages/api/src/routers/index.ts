import type { RouterClient } from "@orpc/server"

import { publicProcedure } from "../index"

import { billingRouter } from "./billing"
import { bugReportRouter } from "./bug-report"
import { captureKeyRouter } from "./capture-key"
import { organizationRouter } from "./organization"

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK"
  }),
  billing: billingRouter,
  bugReport: bugReportRouter,
  captureKey: captureKeyRouter,
  organization: organizationRouter,
}
export type AppRouter = typeof appRouter
export type AppRouterClient = RouterClient<typeof appRouter>
