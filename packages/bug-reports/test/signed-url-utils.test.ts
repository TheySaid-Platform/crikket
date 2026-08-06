import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test"

mock.module("@crikket/env/server", () => ({
  env: {
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/crikket",
    BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:3000",
    STORAGE_BUCKET: "bug-report-bucket",
    STORAGE_REGION: "us-east-1",
    STORAGE_ENDPOINT: "https://s3.us-east-1.amazonaws.com",
    STORAGE_ACCESS_KEY_ID: "access",
    STORAGE_SECRET_ACCESS_KEY: "secret",
    STORAGE_PUBLIC_URL: "https://cdn.example.com/bug-reports",
  },
}))

mock.module("@crikket/db", () => ({
  db: {
    query: {
      bugReportArtifactCleanup: {
        findMany: async () => [],
        findFirst: async () => null,
      },
    },
    delete: () => ({
      where: async () => undefined,
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => undefined,
      }),
    }),
  },
}))

mock.module("@crikket/shared/lib/errors", () => ({
  reportNonFatalError: () => undefined,
  isErrorWithCode: (error: unknown, code: string) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === code,
}))

let isExpiringSignedUrl: typeof import("../src/lib/storage").isExpiringSignedUrl

beforeAll(async () => {
  ;({ isExpiringSignedUrl } = await import("../src/lib/storage"))
})

afterAll(() => {
  mock.restore()
})

describe("isExpiringSignedUrl", () => {
  it("detects AWS v4 presigned URLs", () => {
    const isSigned = isExpiringSignedUrl(
      "https://cdn.example.com/file.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123"
    )

    expect(isSigned).toBeTrue()
  })

  it("detects legacy signed URLs", () => {
    const isSigned = isExpiringSignedUrl(
      "https://cdn.example.com/file.png?AWSAccessKeyId=key&Signature=sig&Expires=123"
    )

    expect(isSigned).toBeTrue()
  })

  it("ignores stable public URLs", () => {
    const isSigned = isExpiringSignedUrl(
      "https://cdn.example.com/bug-reports/file.png"
    )

    expect(isSigned).toBeFalse()
  })
})
