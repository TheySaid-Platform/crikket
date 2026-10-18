import { MCP_ENDPOINT_PATH } from "@crikket/shared/constants/mcp"
import { joinUrlPath } from "@crikket/shared/lib/url"

export const MCP_SERVER_NAME = "crikket"
export const MCP_ACCESS_KEY_PLACEHOLDER = "<your-access-key>"

export function buildMcpEndpointUrl(serverUrl: string): string {
  return joinUrlPath(serverUrl, MCP_ENDPOINT_PATH)
}

export function buildClaudeCodeCommand(endpointUrl: string, key: string) {
  return `claude mcp add --scope user --transport http ${MCP_SERVER_NAME} ${endpointUrl} --header "Authorization: Bearer ${key}"`
}

export function buildCursorConfig(endpointUrl: string, key: string) {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          url: endpointUrl,
          headers: {
            Authorization: `Bearer ${key}`,
          },
        },
      },
    },
    null,
    2
  )
}

export function formatKeyDate(value: string | null, fallback: string): string {
  return value ? new Date(value).toLocaleDateString() : fallback
}

export const SHELL_HISTORY_WARNING =
  "This command contains your key, so your shell saves it in its history. Clear that line from the history afterwards, or use the Cursor JSON in a file instead."
