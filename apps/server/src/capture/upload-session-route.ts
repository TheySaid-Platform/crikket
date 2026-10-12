import {
  createBugReportUploadSession,
  createBugReportUploadSessionInputSchema,
} from "@crikket/bug-reports/lib/upload-session"
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import {
  createCaptureFinalizeToken,
  isCaptureSubmitProtectionEnabled,
  verifyCaptureSubmitToken,
} from "./protection"
import {
  authorizeCaptureSubmitRequest,
  buildJsonResponse,
  toCaptureErrorResponse,
} from "./shared"

// The embed sends videos and screenshots. Instant replays come only from the
// extension, by a signed-in user.
const embedUploadSessionInputSchema =
  createBugReportUploadSessionInputSchema.extend({
    attachmentType: z.enum(["video", "screenshot"]),
  })

async function getRequestBody(
  request: Request
): Promise<z.infer<typeof embedUploadSessionInputSchema>> {
  try {
    return embedUploadSessionInputSchema.parse(
      (await request.json()) as unknown
    )
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Invalid JSON in capture upload session request.",
      })
    }

    throw error
  }
}

export async function handleCaptureUploadSession(input: {
  request: Request
}): Promise<Response> {
  const route = "/api/embed/bug-report-upload-session"
  let keyId: string | null = null
  let origin: string | null = null

  try {
    const authorization = await authorizeCaptureSubmitRequest({
      request: input.request,
      route,
    })
    if (authorization instanceof Response) {
      return authorization
    }

    keyId = authorization.keyId
    origin = authorization.origin

    if (isCaptureSubmitProtectionEnabled()) {
      const submitToken = input.request.headers
        .get("x-crikket-capture-token")
        ?.trim()
      if (!submitToken) {
        throw new ORPCError("UNAUTHORIZED", {
          data: {
            reasonCode: "missing_submit_token",
          },
          message: "Capture submit token is required.",
        })
      }

      await verifyCaptureSubmitToken({
        keyId: authorization.publicKeyId,
        origin: authorization.origin,
        token: submitToken,
      })
    }

    const requestBody = await getRequestBody(input.request)
    const result = await createBugReportUploadSession({
      input: requestBody,
      organizationId: authorization.organizationId,
      reporterId: null,
    })

    const finalizeAuthorization = createCaptureFinalizeToken({
      keyId: authorization.publicKeyId,
      origin: authorization.origin,
      reportId: result.bugReportId,
    })

    return buildJsonResponse(
      {
        bugReportId: result.bugReportId,
        captureUpload: result.captureUpload,
        debuggerUpload: result.debuggerUpload,
        finalizeToken: finalizeAuthorization?.token,
        finalizeTokenExpiresAt: finalizeAuthorization?.expiresAt,
      },
      {
        headers: authorization.rateLimitHeaders,
      }
    )
  } catch (error) {
    return toCaptureErrorResponse(error, {
      keyId,
      method: input.request.method,
      origin,
      route,
    })
  }
}
