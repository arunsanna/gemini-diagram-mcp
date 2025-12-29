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

import { GeminiImageClient, analyzePrompt, DIAGRAM_TYPES } from "./gemini/client.js";
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
    .enum([
      "auto",
      "chart",
      "comparison",
      "flow",
      "architecture",
      "timeline",
      "hierarchy",
      "matrix",
      "hero",
      "visualization",
    ])
    .default("auto")
    .describe("Type of image to generate (auto-detected if not specified)"),
  aspect_ratio: z
    .enum(["16:9", "1:1", "4:3", "3:4", "9:16", "2:1"])
    .optional()
    .describe("Image aspect ratio (auto-selected based on type if not specified)"),
  size: z
    .enum(["1K", "2K", "4K"])
    .default("2K")
    .describe("Image resolution (1K, 2K, or 4K)"),
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
  "Generate a diagram, chart, or visualization using Gemini. Intelligently detects type from prompt and asks clarifying questions when uncertain. Supports: chart, comparison, flow, architecture, timeline, hierarchy, matrix, hero, visualization.",
  GenerateImageSchema.shape,
  async ({ prompt, output, type, aspect_ratio, size }) => {
    try {
      // Smart analysis of prompt
      const analysis = analyzePrompt(prompt, {
        type: type === "auto" ? undefined : type,
        aspectRatio: aspect_ratio,
        size,
      });

      // If low confidence and no explicit type, ask for clarification
      if (!analysis.shouldProceed && analysis.clarifyingQuestion) {
        return {
          content: [
            {
              type: "text" as const,
              text: analysis.clarifyingQuestion,
            },
          ],
        };
      }

      const client = getClient();
      const outputPath = resolveOutputPath(output, prompt);

      // Use recommended values from analysis
      const finalType = analysis.recommendedType;
      const finalAspectRatio = analysis.recommendedAspectRatio;
      const finalSize = analysis.recommendedSize;

      // Generate the image with smart-selected options
      const result = await client.generate(prompt, outputPath, {
        type: finalType,
        aspectRatio: finalAspectRatio,
        size: finalSize,
      });

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
        lastType: finalType,
        aspectRatio: result.aspectRatio,
        size: finalSize,
      });

      // Build response with suggestions if applicable
      let responseText = `Generated ${finalType} (${result.aspectRatio}, ${finalSize}): ${result.outputPath}`;

      if (analysis.suggestions && analysis.suggestions.length > 0) {
        responseText += `\n\nNote: ${analysis.suggestions.join(". ")}. Use 'type' parameter to override.`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: responseText,
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
        {
          type: session.lastType,
          aspectRatio: session.aspectRatio,
          size: session.size,
        }
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
