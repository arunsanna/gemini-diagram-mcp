#!/usr/bin/env node
/**
 * MCP Server for Gemini Image Generation
 *
 * Provides tools for generating diagrams, charts, and visualizations
 * using Google Gemini's image generation capabilities.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "node:path";

import { GeminiImageClient, detectType } from "./gemini/client.js";
import { loadSession, saveSession, clearSession } from "./utils/session.js";

// Validate environment on startup
function validateEnvironment(): void {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error(
      "Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable required"
    );
    console.error("Set it in your shell or Claude Code MCP configuration");
    process.exit(1);
  }
}

// Tool schemas
const GenerateImageSchema = z.object({
  prompt: z
    .string()
    .describe("Natural language description of the image to generate"),
  output: z
    .string()
    .optional()
    .describe("Output filename (auto-generated if not provided)"),
  type: z
    .enum(["diagram", "chart", "visualization", "auto"])
    .default("auto")
    .describe("Type of image to generate"),
});

const RefineImageSchema = z.object({
  refinement: z
    .string()
    .describe("Description of changes to make to the last image"),
});

// Create MCP server
const server = new McpServer({
  name: "gemini-image",
  version: "0.1.0",
});

// Initialize Gemini client (lazy - created on first use)
let geminiClient: GeminiImageClient | null = null;

function getClient(): GeminiImageClient {
  if (!geminiClient) {
    geminiClient = new GeminiImageClient();
  }
  return geminiClient;
}

// Helper: Generate smart filename from prompt
function generateFilename(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);

  return `${words.join("_") || "image"}.png`;
}

// Helper: Resolve output path
function resolveOutputPath(output: string | undefined, prompt: string): string {
  const filename = output ?? generateFilename(prompt);

  // If absolute path, use as-is
  if (path.isAbsolute(filename)) {
    return filename;
  }

  // Otherwise, save to current working directory
  return path.resolve(process.cwd(), filename);
}

// Register generate_image tool
server.tool(
  "generate_image",
  "Generate a diagram, chart, or visualization using Gemini",
  GenerateImageSchema.shape,
  async ({ prompt, output, type }) => {
    try {
      const client = getClient();
      const outputPath = resolveOutputPath(output, prompt);
      const resolvedType = type === "auto" ? detectType(prompt) : type;

      // Generate the image
      const result = await client.generate(prompt, outputPath, type);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to generate image: ${result.error}`,
            },
          ],
          isError: true,
        };
      }

      // Save session for potential refinement
      saveSession({
        lastPrompt: prompt,
        lastOutput: result.outputPath!,
        lastType: resolvedType,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Generated ${resolvedType}: ${result.outputPath}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Register refine_image tool
server.tool(
  "refine_image",
  "Refine the last generated image with modifications",
  RefineImageSchema.shape,
  async ({ refinement }) => {
    try {
      // Load previous session
      const session = loadSession();

      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No previous image to refine. Use generate_image first.",
            },
          ],
          isError: true,
        };
      }

      const client = getClient();

      // Generate refined version with new filename
      const baseName = path.basename(
        session.lastOutput,
        path.extname(session.lastOutput)
      );
      const dir = path.dirname(session.lastOutput);
      const refinedPath = path.join(dir, `${baseName}_refined.png`);

      const result = await client.refine(
        session.lastPrompt,
        refinement,
        refinedPath,
        session.lastType
      );

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to refine image: ${result.error}`,
            },
          ],
          isError: true,
        };
      }

      // Update session with refined image
      saveSession({
        lastPrompt: `${session.lastPrompt}\n\nRefinement: ${refinement}`,
        lastOutput: result.outputPath!,
        lastType: session.lastType,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Refined image: ${result.outputPath}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start server
async function main() {
  validateEnvironment();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gemini Image MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
