import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test"

const envState: {
  DATABASE_URL: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  STORAGE_BUCKET: string
  STORAGE_REGION: string
  STORAGE_ENDPOINT: string
  STORAGE_ADDRESSING_STYLE: "auto" | "path" | "virtual" | undefined
  STORAGE_ACCESS_KEY_ID: string
  STORAGE_SECRET_ACCESS_KEY: string
  STORAGE_PUBLIC_URL: string | undefined
} = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/crikket",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:3000",
  STORAGE_BUCKET: "bug-report-bucket",
  STORAGE_REGION: "auto",
  STORAGE_ENDPOINT: "https://example-account.r2.cloudflarestorage.com",
  STORAGE_ADDRESSING_STYLE: undefined,
  STORAGE_ACCESS_KEY_ID: "access",
  STORAGE_SECRET_ACCESS_KEY: "secret",
  STORAGE_PUBLIC_URL: undefined,
}

mock.module("@crikket/env/server", () => ({
  env: envState,
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
}))

let createS3StorageProvider: typeof import("../src/lib/storage").createS3StorageProvider
let resolveS3ForcePathStyle: typeof import("../src/lib/storage").resolveS3ForcePathStyle

beforeAll(async () => {
  ;({ createS3StorageProvider, resolveS3ForcePathStyle } = await import(
    "../src/lib/storage"
  ))
})

afterAll(() => {
  mock.restore()
})

describe("createUploadUrl", () => {
  it("uses path-style uploads for custom S3-compatible endpoints", async () => {
    const storage = createS3StorageProvider({
      bucket: "bug-report-bucket",
      region: "us-east-1",
      endpoint: "https://apiminio.example.com",
      accessKeyId: "access",
      secretAccessKey: "secret",
    })

    const upload = await storage.createUploadUrl({
      filename: "organizations/org_123/bug-reports/br_123/capture/video.webm",
      contentType: "video/webm",
    })

    const parsed = new URL(upload.url)

    expect(parsed.origin).toBe("https://apiminio.example.com")
    expect(parsed.pathname).toBe(
      "/bug-report-bucket/organizations/org_123/bug-reports/br_123/capture/video.webm"
    )
  })

  it("allows forcing virtual-hosted-style uploads for custom endpoints", async () => {
    const storage = createS3StorageProvider({
      bucket: "bug-report-bucket",
      region: "us-east-1",
      endpoint: "https://apiminio.example.com",
      addressingStyle: "virtual",
      accessKeyId: "access",
      secretAccessKey: "secret",
    })

    const upload = await storage.createUploadUrl({
      filename: "organizations/org_123/bug-reports/br_123/capture/video.webm",
      contentType: "video/webm",
    })

    const parsed = new URL(upload.url)

    expect(parsed.origin).toBe("https://bug-report-bucket.apiminio.example.com")
    expect(parsed.pathname).toBe(
      "/organizations/org_123/bug-reports/br_123/capture/video.webm"
    )
  })

  it("allows forcing path-style uploads for AWS S3 endpoints", async () => {
    const storage = createS3StorageProvider({
      bucket: "bug-report-bucket",
      region: "us-east-1",
      endpoint: "https://s3.us-east-1.amazonaws.com",
      addressingStyle: "path",
      accessKeyId: "access",
      secretAccessKey: "secret",
    })

    const upload = await storage.createUploadUrl({
      filename: "organizations/org_123/bug-reports/br_123/capture/video.webm",
      contentType: "video/webm",
    })

    const parsed = new URL(upload.url)

    expect(parsed.origin).toBe("https://s3.us-east-1.amazonaws.com")
    expect(parsed.pathname).toBe(
      "/bug-report-bucket/organizations/org_123/bug-reports/br_123/capture/video.webm"
    )
  })

  it("keeps path-style uploads for R2 endpoints", async () => {
    const storage = createS3StorageProvider({
      bucket: "bug-report-bucket",
      region: "auto",
      endpoint: "https://example-account.r2.cloudflarestorage.com",
      accessKeyId: "access",
      secretAccessKey: "secret",
    })

    const upload = await storage.createUploadUrl({
      filename: "organizations/org_123/bug-reports/br_123/capture/video.webm",
      contentType: "video/webm",
    })

    const parsed = new URL(upload.url)

    expect(parsed.origin).toBe(
      "https://example-account.r2.cloudflarestorage.com"
    )
    expect(parsed.pathname).toBe(
      "/bug-report-bucket/organizations/org_123/bug-reports/br_123/capture/video.webm"
    )
  })

  it("keeps virtual-hosted-style uploads for AWS S3 endpoints", async () => {
    const storage = createS3StorageProvider({
      bucket: "bug-report-bucket",
      region: "us-east-1",
      endpoint: "https://s3.us-east-1.amazonaws.com",
      accessKeyId: "access",
      secretAccessKey: "secret",
    })

    const upload = await storage.createUploadUrl({
      filename: "organizations/org_123/bug-reports/br_123/capture/video.webm",
      contentType: "video/webm",
    })

    const parsed = new URL(upload.url)

    expect(parsed.origin).toBe(
      "https://bug-report-bucket.s3.us-east-1.amazonaws.com"
    )
    expect(parsed.pathname).toBe(
      "/organizations/org_123/bug-reports/br_123/capture/video.webm"
    )
  })

  it("sets cache-control: no-transform on gzipped uploads so GCS does not auto-decompress on read", async () => {
    const storage = createS3StorageProvider({
      bucket: "bug-report-bucket",
      region: "auto",
      endpoint: "https://storage.googleapis.com",
      accessKeyId: "access",
      secretAccessKey: "secret",
    })

    const upload = await storage.createUploadUrl({
      filename:
        "organizations/org_123/bug-reports/br_123/debugger/payload.json.gz",
      contentType: "application/json",
      contentEncoding: "gzip",
    })

    expect(upload.headers["cache-control"]).toBe("no-transform")
    expect(upload.headers["content-encoding"]).toBe("gzip")
    expect(upload.headers["content-type"]).toBe("application/json")
  })

  it("omits cache-control when no content-encoding is set", async () => {
    const storage = createS3StorageProvider({
      bucket: "bug-report-bucket",
      region: "auto",
      endpoint: "https://storage.googleapis.com",
      accessKeyId: "access",
      secretAccessKey: "secret",
    })

    const upload = await storage.createUploadUrl({
      filename: "organizations/org_123/bug-reports/br_123/capture/video.webm",
      contentType: "video/webm",
    })

    expect(upload.headers["cache-control"]).toBeUndefined()
  })

  it("does not include flexible checksum query params in presigned upload urls", async () => {
    const storage = createS3StorageProvider({
      bucket: "bug-report-bucket",
      region: "auto",
      endpoint: "https://example-account.r2.cloudflarestorage.com",
      accessKeyId: "access",
      secretAccessKey: "secret",
    })

    const upload = await storage.createUploadUrl({
      filename: "organizations/org_123/bug-reports/br_123/capture/video.webm",
      contentType: "video/webm",
    })

    const parsed = new URL(upload.url)

    expect(parsed.searchParams.has("x-amz-checksum-crc32")).toBeFalse()
    expect(parsed.searchParams.has("x-amz-sdk-checksum-algorithm")).toBeFalse()
  })
})

describe("resolveS3ForcePathStyle", () => {
  it("returns false when no endpoint is configured", () => {
    expect(
      resolveS3ForcePathStyle({
        endpoint: undefined,
      })
    ).toBeFalse()
  })

  it("returns true for R2 hostnames", () => {
    expect(
      resolveS3ForcePathStyle({
        endpoint: "https://example-account.r2.cloudflarestorage.com",
      })
    ).toBeTrue()
  })

  it("returns false for AWS S3 hostnames", () => {
    expect(
      resolveS3ForcePathStyle({
        endpoint: "https://s3.us-east-1.amazonaws.com",
      })
    ).toBeFalse()
    expect(
      resolveS3ForcePathStyle({
        endpoint: "https://s3-accelerate.amazonaws.com",
      })
    ).toBeFalse()
  })

  it("returns true for non-AWS custom endpoints", () => {
    expect(
      resolveS3ForcePathStyle({
        endpoint: "https://apiminio.example.com",
      })
    ).toBeTrue()
  })

  it("allows explicit path-style override", () => {
    expect(
      resolveS3ForcePathStyle({
        endpoint: "https://s3.us-east-1.amazonaws.com",
        addressingStyle: "path",
      })
    ).toBeTrue()
  })

  it("allows explicit virtual-hosted-style override", () => {
    expect(
      resolveS3ForcePathStyle({
        endpoint: "https://apiminio.example.com",
        addressingStyle: "virtual",
      })
    ).toBeFalse()
  })
})
