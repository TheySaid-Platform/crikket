import { getOrganizationEntitlements } from "@crikket/billing/service/entitlements/organization-entitlements"
import { ORPCError } from "@orpc/server"

export interface CreateBugReportEntitlementInput {
  attachmentType: "video" | "screenshot" | "replay"
  metadata?: {
    durationMs?: number
  }
}

export async function assertCreateBugReportEntitlements(input: {
  organizationId: string
  payload: CreateBugReportEntitlementInput
}): Promise<void> {
  const entitlements = await getOrganizationEntitlements(input.organizationId)

  if (!entitlements.canCreateBugReports) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "This organization is on the free plan. Upgrade to Pro to create bug reports.",
    })
  }

  // An instant replay is a recording too, with the same plan limits.
  if (input.payload.attachmentType === "screenshot") {
    return
  }

  if (!entitlements.canUploadVideo) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Video uploads are not available for this organization plan. Upgrade to Pro to continue.",
    })
  }

  if (typeof entitlements.maxVideoDurationMs !== "number") {
    return
  }

  const durationMs = input.payload.metadata?.durationMs
  if (typeof durationMs !== "number") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Video duration metadata is required for video uploads.",
    })
  }

  if (durationMs > entitlements.maxVideoDurationMs) {
    throw new ORPCError("FORBIDDEN", {
      message: "Video exceeds your organization plan duration limit.",
    })
  }
}
