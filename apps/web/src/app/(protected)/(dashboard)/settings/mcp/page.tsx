import { env } from "@crikket/env/web"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getProtectedAuthData } from "@/app/(protected)/_lib/get-protected-auth-data"
import { client } from "@/utils/orpc"

import { McpAccessManagement } from "../_components/mcp-access/mcp-access-management"
import { buildMcpEndpointUrl } from "../_components/mcp-access/utils"
import { getRequestErrorMessage } from "../_lib/get-request-error-message"

export const metadata: Metadata = {
  title: "AI Tools (MCP) Settings",
  description:
    "Create access keys so AI tools like Claude Code and Cursor can read your bug reports.",
}

export default async function McpSettingsPage() {
  const { organizations, session } = await getProtectedAuthData()

  if (!session) {
    redirect("/login")
  }

  if (organizations.length === 0) {
    redirect("/onboarding")
  }

  const activeOrganization =
    organizations.find(
      (organization) => organization.id === session.session.activeOrganizationId
    ) ?? organizations[0]

  const keysState = await client.mcpAccessKey
    .list()
    .then((data) => ({
      data,
      error: null,
    }))
    .catch((error) => ({
      data: [],
      error,
    }))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-xl tracking-tight">AI Tools (MCP)</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Let AI coding tools read bug reports from {activeOrganization.name}:
          details, steps, console logs and network requests.
        </p>
      </div>

      <McpAccessManagement
        endpointUrl={buildMcpEndpointUrl(env.NEXT_PUBLIC_SERVER_URL)}
        initialKeys={keysState.data}
        organizationName={activeOrganization.name}
      />

      {keysState.error ? (
        <p className="text-destructive text-sm">
          Failed to load access keys: {getRequestErrorMessage(keysState.error)}
        </p>
      ) : null}
    </div>
  )
}
