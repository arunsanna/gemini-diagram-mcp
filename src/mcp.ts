/**
 * Gemini Diagram MCP tool registration.
 *
 * This module is shared by:
 * - stdio mode (classic MCP server spawned by a client)
 * - HTTP mode (centralized MCP server)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { GeminiImageClient, analyzePrompt } from "./gemini/client.js";

export const GenerateImageSchema = z.object({
  prompt: z
    .string()
    .describe("Natural language description of the image to generate"),
  output: z
    .string()
    .optional()
    .describe(
      "Output filename (auto-generated if not provided). In server mode, this is treated as a filename only."
    ),
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
    .describe(
      "Image aspect ratio (auto-selected based on type if not specified)"
    ),
  size: z
    .enum(["1K", "2K", "4K"])
    .default("2K")
    .describe("Image resolution (1K, 2K, or 4K)"),
});

export const RefineImageSchema = z.object({
  refinement: z.string().describe("Description of changes to make to the last image"),
});

export interface CreateGeminiDiagramServerOptions {
  name?: string;
  version?: string;
  /**
   * Where to write output images. This folder will be created if needed.
   */
  outputDir: string;
  /**
   * Optional base URL that serves files from outputDir at /files/:filename.
   * If set, tool responses include a download URL.
   */
  publicBaseUrl?: string;
  /**
   * If true, an absolute output path provided by the user is used as-is.
   * For centralized server mode this should be false.
   */
  allowAbsoluteOutput?: boolean;
  /**
   * If true, relative output paths can include subdirectories under outputDir.
   * For centralized server mode this should usually be false.
   */
  allowSubdirsInOutput?: boolean;
  /**
   * If true, include an MCP `image` content block (base64 PNG) in the tool result.
   */
  inlineImages?: boolean;
}

type LastImageSession = {
  lastPrompt: string;
  lastOutputPath: string;
  lastType: string;
  aspectRatio?: string;
  size?: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function slugFromPrompt(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  return words.join("_") || "image";
}

function ensurePngExtension(name: string): string {
  return name.toLowerCase().endsWith(".png") ? name : `${name}.png`;
}

function sanitizeFilename(input: string): string {
  const base = path.basename(input);
  // Keep it simple and cross-platform.
  let cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  cleaned = ensurePngExtension(cleaned);

  // Avoid empty names.
  if (cleaned === ".png" || cleaned.trim() === "") {
    cleaned = `image_${randomUUID().slice(0, 8)}.png`;
  }

  // Conservative length guard.
  const MAX_LEN = 180;
  if (cleaned.length > MAX_LEN) {
    cleaned = cleaned.slice(0, MAX_LEN);
    cleaned = ensurePngExtension(cleaned.replace(/\.png$/i, ""));
  }

  return cleaned;
}

function resolveOutputPath(
  outputDir: string,
  output: string | undefined,
  prompt: string,
  opts: { allowAbsoluteOutput: boolean; allowSubdirsInOutput: boolean }
): { outputPath: string; filenameForUrl?: string } {
  if (output) {
    if (opts.allowAbsoluteOutput && path.isAbsolute(output)) {
      return { outputPath: output };
    }

    if (opts.allowSubdirsInOutput) {
      const withExt = ensurePngExtension(output);
      return {
        outputPath: path.resolve(outputDir, withExt),
        filenameForUrl: path.basename(withExt),
      };
    }

    // Central/server-safe mode: treat output as a flat, sanitized filename.
    const safeWithExt = sanitizeFilename(output);
    return {
      outputPath: path.resolve(outputDir, safeWithExt),
      filenameForUrl: path.basename(safeWithExt),
    };
  }

  const auto = `${slugFromPrompt(prompt)}_${randomUUID().slice(0, 8)}.png`;
  return {
    outputPath: path.resolve(outputDir, auto),
    filenameForUrl: path.basename(auto),
  };
}

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const root = path.resolve(rootDir) + path.sep;
  const candidate = path.resolve(candidatePath);
  return candidate.startsWith(root);
}

export function createGeminiDiagramServer(
  options: CreateGeminiDiagramServerOptions
): McpServer {
  const outputDir = options.outputDir;
  fs.mkdirSync(outputDir, { recursive: true });

  const server = new McpServer({
    name: options.name ?? "gemini-image",
    version: options.version ?? "0.0.0",
  });

  let geminiClient: GeminiImageClient | null = null;
  const getClient = (): GeminiImageClient => {
    if (!geminiClient) {
      geminiClient = new GeminiImageClient();
    }
    return geminiClient;
  };

  let last: LastImageSession | null = null;
  const inlineImages = options.inlineImages ?? false;
  const allowAbsoluteOutput = options.allowAbsoluteOutput ?? true;
  const allowSubdirsInOutput = options.allowSubdirsInOutput ?? true;
  const publicBaseUrl = options.publicBaseUrl
    ? normalizeBaseUrl(options.publicBaseUrl)
    : undefined;

  server.tool(
    "generate_image",
    "Generate a diagram, chart, or visualization using Gemini. Intelligently detects type from prompt and asks clarifying questions when uncertain. Supports: chart, comparison, flow, architecture, timeline, hierarchy, matrix, hero, visualization.",
    GenerateImageSchema.shape,
    async ({ prompt, output, type, aspect_ratio, size }) => {
      try {
        const analysis = analyzePrompt(prompt, {
          type: type === "auto" ? undefined : type,
          aspectRatio: aspect_ratio,
          size,
        });

        if (!analysis.shouldProceed && analysis.clarifyingQuestion) {
          return {
            content: [{ type: "text" as const, text: analysis.clarifyingQuestion }],
          };
        }

        const { outputPath, filenameForUrl } = resolveOutputPath(
          outputDir,
          output,
          prompt,
          {
            allowAbsoluteOutput,
            allowSubdirsInOutput,
          }
        );

        const finalType = analysis.recommendedType;
        const finalAspectRatio = analysis.recommendedAspectRatio;
        const finalSize = analysis.recommendedSize;

        const client = getClient();
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

        last = {
          lastPrompt: prompt,
          lastOutputPath: result.outputPath!,
          lastType: finalType,
          aspectRatio: result.aspectRatio,
          size: finalSize,
        };

        const lines: string[] = [
          `Generated ${finalType} (${result.aspectRatio}, ${finalSize})`,
          `Saved: ${result.outputPath}`,
        ];

        if (publicBaseUrl && filenameForUrl && isPathInsideRoot(outputDir, result.outputPath!)) {
          lines.push(`Download: ${publicBaseUrl}/files/${encodeURIComponent(filenameForUrl)}`);
          lines.push("Note: download requires MCP_AUTH_TOKEN (Authorization header or ?token=...).");
        }

        if (analysis.suggestions && analysis.suggestions.length > 0) {
          lines.push(
            `Note: ${analysis.suggestions.join(". ")}. Use 'type' parameter to override.`
          );
        }

        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text: lines.join("\n") }];

        if (inlineImages && result.imageData) {
          content.push({
            type: "image",
            data: result.imageData.toString("base64"),
            mimeType: "image/png",
          });
        }

        return { content };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "refine_image",
    "Refine the last generated image with modifications",
    RefineImageSchema.shape,
    async ({ refinement }) => {
      try {
        if (!last) {
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

        const baseName = path.basename(
          last.lastOutputPath,
          path.extname(last.lastOutputPath)
        );
        const dir = path.dirname(last.lastOutputPath);
        const refinedPath = path.join(dir, `${baseName}_refined_${randomUUID().slice(0, 8)}.png`);

        const result = await client.refine(
          last.lastPrompt,
          refinement,
          refinedPath,
          {
            type: last.lastType,
            aspectRatio: last.aspectRatio,
            size: last.size,
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

        last = {
          lastPrompt: `${last.lastPrompt}\n\nRefinement: ${refinement}`,
          lastOutputPath: result.outputPath!,
          lastType: last.lastType,
          aspectRatio: last.aspectRatio,
          size: last.size,
        };

        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text: `Refined image saved: ${result.outputPath}` }];

        if (inlineImages && result.imageData) {
          content.push({
            type: "image",
            data: result.imageData.toString("base64"),
            mimeType: "image/png",
          });
        }

        return { content };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
