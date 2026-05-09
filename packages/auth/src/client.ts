import { env } from "@crikket/env/web"
import { polarClient } from "@polar-sh/better-auth"
import type { BetterAuthClientOptions } from "better-auth/client"
import { adminClient, organizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

const adminPlugin = adminClient()
const organizationPlugin = organizationClient()
const polarPlugin: ReturnType<typeof polarClient> = polarClient()

type AuthClientOptions = {
  baseURL: string
  plugins: [typeof adminPlugin, typeof organizationPlugin, typeof polarPlugin]
}

type AuthClient<Option extends BetterAuthClientOptions> = ReturnType<
  typeof createAuthClient<Option>
>

export const authClient: AuthClient<AuthClientOptions> = createAuthClient({
  baseURL: env.NEXT_PUBLIC_SERVER_URL,
  plugins: [adminPlugin, organizationPlugin, polarPlugin],
})
