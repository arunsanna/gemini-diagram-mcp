import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createGeminiDiagramServer } from "./mcp.js";
import {
  createNoAuthVerifierFromEnv,
  createOidcAuthVerifierFromEnv,
  createTokenAuthVerifierFromEnv,
  parseAuthMode,
} from "./auth.js";
import { assertApiKeyPresent, getPackageVersion } from "./runtime.js";

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return fallback;
  return n;
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function startHttpServer(): Promise<void> {
  assertApiKeyPresent();
  const authMode = parseAuthMode(process.env.MCP_AUTH_MODE);
  const authVerifier =
    authMode === "oidc"
      ? await createOidcAuthVerifierFromEnv()
      : authMode === "none"
        ? createNoAuthVerifierFromEnv()
        : createTokenAuthVerifierFromEnv();

  const host = process.env.HOST ?? "0.0.0.0";
  const port = parsePort(process.env.PORT, 3000);

  const outputDir =
    process.env.OUTPUT_DIR ?? path.resolve(process.cwd(), "data", "out");
  fs.mkdirSync(outputDir, { recursive: true });

  const publicBaseUrl = normalizeBaseUrl(
    process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`
  );

  const allowedHosts = process.env.ALLOWED_HOSTS
    ? process.env.ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean)
    : undefined;

  const app = createMcpExpressApp({ host, allowedHosts });

  // Health check does not require auth (so orchestrators can probe).
  app.get("/healthz", (_req: any, res: any) => {
    res.status(200).json({ ok: true });
  });

  // Authentication (token / OIDC / none).
  app.use((req: any, res: any, next: any) => {
    void (async () => {
      const result = await authVerifier.verifyRequest(req);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      // Stash claims for potential downstream use/logging.
      (req as any).mcpAuth = {
        mode: authVerifier.mode,
        claims: result.claims,
      };
      next();
    })().catch((error) => {
      console.error("Auth middleware error:", error);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    });
  });

  app.get("/files/:filename", (req: any, res: any) => {
    const filename = String(req.params.filename || "");
    // Prevent traversal; we only serve files in OUTPUT_DIR.
    if (filename !== path.basename(filename)) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const fullPath = path.resolve(outputDir, filename);
    const root = path.resolve(outputDir) + path.sep;
    if (!fullPath.startsWith(root)) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.sendFile(fullPath);
  });

  // Store transports by session ID (both Streamable HTTP and legacy SSE).
  const transports: Record<string, StreamableHTTPServerTransport | SSEServerTransport> =
    Object.create(null);

  // Streamable HTTP transport (recommended)
  app.all("/mcp", async (req: any, res: any) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        const existing = transports[sessionId];
        if (existing instanceof StreamableHTTPServerTransport) {
          transport = existing;
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message:
                "Bad Request: Session exists but uses a different transport protocol",
            },
            id: null,
          });
          return;
        }
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport;
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
          }
        };

        const server = createGeminiDiagramServer({
          name: "gemini-image",
          version: getPackageVersion(),
          outputDir,
          publicBaseUrl,
          allowAbsoluteOutput: false,
          allowSubdirsInOutput: false,
          inlineImages: process.env.INLINE_IMAGES === "1",
        });

        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling /mcp request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Legacy SSE transport (for older clients)
  app.get("/sse", async (req: any, res: any) => {
    try {
      const transport = new SSEServerTransport("/messages", res);
      transports[transport.sessionId] = transport;
      res.on("close", () => {
        delete transports[transport.sessionId];
      });

      const server = createGeminiDiagramServer({
        name: "gemini-image",
        version: getPackageVersion(),
        outputDir,
        publicBaseUrl,
        allowAbsoluteOutput: false,
        allowSubdirsInOutput: false,
        inlineImages: process.env.INLINE_IMAGES === "1",
      });

      await server.connect(transport);
    } catch (error) {
      console.error("Error establishing /sse transport:", error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  });

  app.post("/messages", async (req: any, res: any) => {
    const sessionId = String(req.query?.sessionId || "");
    const existing = transports[sessionId];
    if (!(existing instanceof SSEServerTransport)) {
      res.status(400).json({ error: "No SSE transport found for sessionId" });
      return;
    }

    await existing.handlePostMessage(req, res, req.body);
  });

  const httpServer = app.listen(port, host, (err: any) => {
    if (err) {
      console.error("Failed to start HTTP server:", err);
      process.exit(1);
    }

    console.error(`Gemini Diagram MCP server listening on http://${host}:${port}`);
    console.error(`MCP endpoint (Streamable HTTP): ${publicBaseUrl}/mcp`);
    console.error(`Legacy SSE endpoint: ${publicBaseUrl}/sse`);
    console.error(`Files endpoint: ${publicBaseUrl}/files/<filename>`);
    console.error(`Output directory: ${path.resolve(outputDir)}`);
  });

  async function shutdown(signal: string) {
    console.error(`Shutting down (${signal})...`);
    httpServer.close();
    const ids = Object.keys(transports);
    await Promise.all(
      ids.map(async (sid) => {
        try {
          await transports[sid].close();
        } catch {
          // Ignore.
        } finally {
          delete transports[sid];
        }
      })
    );
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
