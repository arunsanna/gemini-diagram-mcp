#!/usr/bin/env node
/**
 * MCP Server for Gemini Diagram Image Generation
 *
 * Provides tools for generating diagrams, charts, and visualizations
 * using Google Gemini's image generation capabilities.
 */

import { startHttpServer } from "./http.js";
import { startProxyServer } from "./proxy.js";
import { startStdioServer } from "./stdio.js";
import { GeminiImageClient, type StyleMode } from "./gemini/client.js";
import { enforceVertexAiMode, assertVertexConfigPresent } from "./runtime.js";
import * as path from "node:path";

function printHelp(): void {
  console.error(`gemini-diagram-mcp

Usage:
  gemini-diagram-mcp                 Start stdio MCP server (default)
  gemini-diagram-mcp http            Start centralized HTTP MCP server
  gemini-diagram-mcp proxy           Start stdio proxy that forwards to a remote HTTP MCP server
  gemini-diagram-mcp generate "prompt" [-o file] [-t type] [--size 2K] [--style professional]
                                     Generate an image directly from the CLI

Environment:
  VERTEX_AI_API_KEY                  Preferred Vertex AI API key for stdio/http server modes
  GOOGLE_API_KEY                     Backward-compatible Vertex AI API key env var
  GOOGLE_CLOUD_API_KEY               Alternate Vertex AI API key env var
  GOOGLE_GENAI_USE_VERTEXAI          Forced to true by the server at runtime
  VERTEX_AI_IMAGE_MODEL              Optional model override (default: gemini-3-pro-image-preview)
  MCP_AUTH_MODE                      Auth mode for HTTP server: token (default), oidc, none
  MCP_AUTH_TOKEN                     Auth for token mode (HTTP server) and legacy proxy env var
  MCP_AUTH_TOKENS                    Optional comma-separated tokens (replaces MCP_AUTH_TOKEN)
  OIDC_ISSUER                         Required for oidc mode (e.g. https://issuer.example.com/realms/foo)
  OIDC_AUDIENCE                       Recommended for oidc mode (comma-separated allowed audiences)
  OIDC_JWKS_URI                       Optional override to skip discovery
  MCP_ALLOW_QUERY_TOKEN=1             Allow ?token=... (default: enabled for token mode, disabled for oidc)
  MCP_REMOTE_URL                     Proxy remote URL (default: http://localhost:3000/mcp)
  MCP_BEARER_TOKEN                   Proxy auth bearer token (use for OIDC access tokens)

HTTP server options:
  HOST                               Bind host (default: 0.0.0.0)
  PORT                               Bind port (default: 3000)
  OUTPUT_DIR                         Output directory (default: ./data/out)
  PUBLIC_BASE_URL                    Base URL for links (default: http://localhost:$PORT)
  INLINE_IMAGES=1                    Include base64 image data in tool results (optional)
`);
}

function parseCliArgs(args: string[]): {
  prompt: string;
  output?: string;
  type?: string;
  size?: string;
  style?: string;
} {
  const prompt = args.find((a) => !a.startsWith("-"));
  if (!prompt) {
    console.error(
      'Error: prompt is required.\nUsage: gemini-diagram-mcp generate "your prompt" [-o output.png]',
    );
    process.exit(1);
  }
  const flag = (short: string, long: string): string | undefined => {
    const idx = args.findIndex((a) => a === short || a === long);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  return {
    prompt,
    output: flag("-o", "--output"),
    type: flag("-t", "--type"),
    size: flag("-s", "--size"),
    style: flag("--style", "--style"),
  };
}

async function runCliGenerate(): Promise<void> {
  enforceVertexAiMode();
  assertVertexConfigPresent();
  const args = process.argv.slice(3);
  const opts = parseCliArgs(args);
  const slug = opts.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 40)
    .replace(/_+$/, "");
  const output = opts.output || `${slug}.png`;
  const outputPath = path.resolve(process.cwd(), output);
  const client = new GeminiImageClient();
  console.error(`Generating: "${opts.prompt}"`);
  console.error(`Output: ${outputPath}`);
  const result = await client.generate(opts.prompt, outputPath, {
    type: opts.type || "auto",
    size: opts.size || "2K",
    style: (opts.style || "professional") as StyleMode,
  });
  if (result.success) {
    console.log(result.outputPath);
    if (result.dimensionWarning)
      console.error(`Warning: ${result.dimensionWarning}`);
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];

  if (mode === "-h" || mode === "--help") {
    printHelp();
    return;
  }

  if (mode === "http" || mode === "serve") {
    await startHttpServer();
    return;
  }

  if (mode === "proxy") {
    await startProxyServer();
    return;
  }

  if (mode === "generate") {
    await runCliGenerate();
    return;
  }

  // Default
  await startStdioServer();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
