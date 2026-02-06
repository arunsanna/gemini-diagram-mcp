import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "node:path";

import { createGeminiDiagramServer } from "./mcp.js";
import { assertApiKeyPresent, getPackageVersion } from "./runtime.js";

export async function startStdioServer(): Promise<void> {
  assertApiKeyPresent();

  const outputDir = process.cwd();
  const server = createGeminiDiagramServer({
    name: "gemini-image",
    version: getPackageVersion(),
    outputDir,
    allowAbsoluteOutput: true,
    allowSubdirsInOutput: true,
    // Inline images are usually not desirable for stdio clients; keep it opt-in.
    inlineImages: process.env.INLINE_IMAGES === "1",
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Gemini Diagram MCP server running on stdio (output: ${path.resolve(outputDir)})`
  );
}

