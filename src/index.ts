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

function printHelp(): void {
  console.error(`gemini-diagram-mcp

Usage:
  gemini-diagram-mcp                 Start stdio MCP server (default)
  gemini-diagram-mcp http            Start centralized HTTP MCP server
  gemini-diagram-mcp proxy           Start stdio proxy that forwards to a remote HTTP MCP server

Environment:
  GEMINI_API_KEY or GOOGLE_API_KEY   Required for stdio/http server modes
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
  INLINE_IMAGES=1                    Include base64 PNG in tool results (optional)
`);
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

  // Default
  await startStdioServer();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
