import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { GenerateImageSchema, RefineImageSchema } from "./mcp.js";
import { getPackageVersion, requireEnv } from "./runtime.js";

function normalizeCallToolResult(result: any): any {
  // New protocol returns { content, structuredContent?, isError? }.
  if (result && typeof result === "object" && Array.isArray(result.content)) {
    return result;
  }

  // Compatibility mode may return { toolResult }. Best-effort wrapping.
  const text =
    result && typeof result === "object" && "toolResult" in result
      ? JSON.stringify((result as any).toolResult)
      : String(result);

  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

function normalizeRemoteUrl(raw: string): string {
  const url = new URL(raw);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/mcp";
  }
  return url.toString();
}

export async function startProxyServer(): Promise<void> {
  const authToken = requireEnv("MCP_AUTH_TOKEN");
  const remoteUrl = normalizeRemoteUrl(
    process.env.MCP_REMOTE_URL ?? "http://localhost:3000/mcp"
  );

  const client = new Client(
    { name: "gemini-diagram-proxy", version: getPackageVersion() },
    { capabilities: {} }
  );

  const transport = new StreamableHTTPClientTransport(new URL(remoteUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  });

  await client.connect(transport);

  const server = new McpServer({
    name: "gemini-image-proxy",
    version: getPackageVersion(),
  });

  server.tool(
    "generate_image",
    "Proxy to remote gemini-diagram MCP server (generate_image)",
    GenerateImageSchema.shape,
    async (args) => {
      try {
        const result = await client.callTool({
          name: "generate_image",
          arguments: args,
        }, CallToolResultSchema);
        return normalizeCallToolResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Proxy error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "refine_image",
    "Proxy to remote gemini-diagram MCP server (refine_image)",
    RefineImageSchema.shape,
    async (args) => {
      try {
        const result = await client.callTool({
          name: "refine_image",
          arguments: args,
        }, CallToolResultSchema);
        return normalizeCallToolResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Proxy error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
  console.error(`Gemini Diagram MCP proxy running on stdio (remote: ${remoteUrl})`);
}
