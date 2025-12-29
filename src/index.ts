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

// Tool schemas
const GenerateImageSchema = z.object({
  prompt: z.string().describe("Natural language description of the image to generate"),
  output: z.string().optional().describe("Output filename (auto-generated if not provided)"),
  type: z
    .enum(["diagram", "chart", "visualization", "auto"])
    .default("auto")
    .describe("Type of image to generate"),
});

const RefineImageSchema = z.object({
  refinement: z.string().describe("Description of changes to make to the last image"),
});

// Create MCP server
const server = new McpServer({
  name: "gemini-image",
  version: "0.1.0",
});

// State for refinement
let lastGeneratedImage: string | null = null;
let lastPrompt: string | null = null;

// Register tools
server.tool(
  "generate_image",
  "Generate a diagram, chart, or visualization using Gemini",
  GenerateImageSchema.shape,
  async ({ prompt, output, type }) => {
    // TODO: Implement Gemini image generation
    // 1. Detect type if auto
    // 2. Generate image via Gemini API
    // 3. Save to output path
    // 4. Update state for refinement

    const filename = output ?? generateFilename(prompt);

    // Placeholder response
    return {
      content: [
        {
          type: "text" as const,
          text: `[TODO] Would generate ${type} image from: "${prompt}" → ${filename}`,
        },
      ],
    };
  }
);

server.tool(
  "refine_image",
  "Refine the last generated image with modifications",
  RefineImageSchema.shape,
  async ({ refinement }) => {
    if (!lastGeneratedImage || !lastPrompt) {
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

    // TODO: Implement refinement
    // 1. Combine original prompt with refinement
    // 2. Regenerate image
    // 3. Update state

    return {
      content: [
        {
          type: "text" as const,
          text: `[TODO] Would refine "${lastGeneratedImage}" with: "${refinement}"`,
        },
      ],
    };
  }
);

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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gemini Image MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
