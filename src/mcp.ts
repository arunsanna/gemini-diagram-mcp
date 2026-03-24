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

import {
  GeminiImageClient,
  analyzePrompt,
  DIAGRAM_TYPES,
  ASPECT_RATIO_VALUES,
  buildPromptFromContext,
  type StyleMode,
} from "./gemini/client.js";

export const GenerateImageSchema = z.object({
  prompt: z
    .string()
    .describe("Natural language description of the image to generate"),
  output: z
    .string()
    .optional()
    .describe(
      "Output filename (auto-generated if not provided). In server mode, this is treated as a filename only.",
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
    .enum(["16:9", "1:1", "4:3", "3:4", "9:16", "3:2", "2:3", "21:9"])
    .optional()
    .describe(
      "Image aspect ratio (auto-selected based on type if not specified)",
    ),
  size: z
    .enum(["1K", "2K", "4K"])
    .default("2K")
    .describe("Image resolution (1K, 2K, or 4K)"),
  style: z
    .enum(["professional", "creative"])
    .default("professional")
    .describe(
      "Style mode. 'professional' enforces clean SaaS aesthetic (white bg, standard palette). " +
        "'creative' removes aesthetic constraints so the prompt drives the look (vintage, retro, dark, artistic, etc.)",
    ),
});

export const RefineImageSchema = z.object({
  refinement: z
    .string()
    .describe("Description of changes to make to the last image"),
});

export const PrepareImageSchema = z.object({
  prompt: z
    .string()
    .optional()
    .describe(
      "Optional draft prompt to analyze. If provided, returns recommendations and a polished version.",
    ),
  type: z
    .string()
    .optional()
    .describe("Optional type hint to get specific guidance for that type"),
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
   * If true, include an MCP `image` content block in the tool result.
   */
  inlineImages?: boolean;
}

type LastImageSession = {
  lastPrompt: string;
  lastOutputPath: string;
  lastType: string;
  aspectRatio?: string;
  size?: string;
  style?: StyleMode;
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

function sanitizeFilename(input: string): string {
  const base = path.basename(input);
  // Keep it simple and cross-platform.
  let cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Avoid empty names.
  if (cleaned === "." || cleaned.trim() === "") {
    cleaned = `image_${randomUUID().slice(0, 8)}`;
  }

  // Conservative length guard.
  const MAX_LEN = 180;
  if (cleaned.length > MAX_LEN) {
    cleaned = cleaned.slice(0, MAX_LEN);
    cleaned = cleaned.replace(/\.+$/g, "");
  }

  return cleaned;
}

function resolveOutputPath(
  outputDir: string,
  output: string | undefined,
  prompt: string,
  opts: { allowAbsoluteOutput: boolean; allowSubdirsInOutput: boolean },
): { outputPath: string; filenameForUrl?: string } {
  if (output) {
    if (opts.allowAbsoluteOutput && path.isAbsolute(output)) {
      return { outputPath: output };
    }

    if (opts.allowSubdirsInOutput) {
      return {
        outputPath: path.resolve(outputDir, output),
        filenameForUrl: path.basename(output),
      };
    }

    // Central/server-safe mode: treat output as a flat, sanitized filename.
    const safeWithExt = sanitizeFilename(output);
    return {
      outputPath: path.resolve(outputDir, safeWithExt),
      filenameForUrl: path.basename(safeWithExt),
    };
  }

  const auto = `${slugFromPrompt(prompt)}_${randomUUID().slice(0, 8)}`;
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
  options: CreateGeminiDiagramServerOptions,
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
    async ({ prompt, output, type, aspect_ratio, size, style }) => {
      try {
        const analysis = analyzePrompt(prompt, {
          type: type === "auto" ? undefined : type,
          aspectRatio: aspect_ratio,
          size,
        });

        if (!analysis.shouldProceed && analysis.clarifyingQuestion) {
          return {
            content: [
              { type: "text" as const, text: analysis.clarifyingQuestion },
            ],
          };
        }

        const { outputPath } = resolveOutputPath(outputDir, output, prompt, {
          allowAbsoluteOutput,
          allowSubdirsInOutput,
        });

        const finalType = analysis.recommendedType;
        const finalAspectRatio = analysis.recommendedAspectRatio;
        const finalSize = analysis.recommendedSize;

        const client = getClient();
        let dimensionNote = "";
        const result = await client.generate(prompt, outputPath, {
          type: finalType,
          aspectRatio: finalAspectRatio,
          size: finalSize,
          style,
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

        // Dimension mismatch — warn but keep the image
        if (result.dimensionWarning) {
          const dimInfo =
            result.actualWidth && result.actualHeight
              ? `${result.actualWidth}x${result.actualHeight}px`
              : "unknown";
          const longestSide = Math.max(
            result.actualWidth ?? 0,
            result.actualHeight ?? 0,
          );
          const actualTier =
            longestSide >= 3600 ? "4K" : longestSide >= 1800 ? "2K" : "1K";
          dimensionNote = `Note: Requested ${finalSize} but API delivered ${actualTier} (${dimInfo}). Image kept.`;
        }

        const activeStyle: StyleMode = style || "professional";

        last = {
          lastPrompt: prompt,
          lastOutputPath: result.outputPath!,
          lastType: finalType,
          aspectRatio: result.aspectRatio,
          size: finalSize,
          style: activeStyle,
        };

        const dimStr =
          result.actualWidth && result.actualHeight
            ? ` [${result.actualWidth}x${result.actualHeight}px]`
            : "";
        const lines: string[] = [
          `Generated ${finalType} (${result.aspectRatio}, ${finalSize}, style: ${activeStyle})${dimStr}`,
          `Saved: ${result.outputPath}`,
        ];

        const resultFilename = path.basename(result.outputPath!);
        if (publicBaseUrl && isPathInsideRoot(outputDir, result.outputPath!)) {
          lines.push(
            `Download: ${publicBaseUrl}/files/${encodeURIComponent(resultFilename)}`,
          );
          const authMode = process.env.MCP_AUTH_MODE ?? "token";
          if (authMode === "token") {
            lines.push(
              "Note: download requires MCP_AUTH_TOKEN (Authorization header or ?token=...).",
            );
          } else if (authMode === "oidc") {
            lines.push("Note: download requires an OIDC bearer token.");
          }
        }

        if (dimensionNote) {
          lines.push(dimensionNote);
        }

        if (analysis.suggestions && analysis.suggestions.length > 0) {
          lines.push(
            `Note: ${analysis.suggestions.join(". ")}. Use 'type' parameter to override.`,
          );
        }

        // Hint about creative mode when prompt suggests non-professional styling
        if (activeStyle === "professional") {
          const lowerPrompt = prompt.toLowerCase();
          const creativeKeywords = [
            "vintage",
            "retro",
            "hand-drawn",
            "sketch",
            "watercolor",
            "artistic",
            "dark theme",
            "dark mode",
            "neon",
            "grunge",
            "minimalist art",
            "pastel",
            "sepia",
            "old-fashioned",
            "rustic",
            "elegant",
            "gothic",
            "comic",
            "cartoon",
            "comic book",
            "comic panel",
            "manga",
            "graphic novel",
            "story panel",
            "speech bubble",
            "whiteboard",
            "marker",
            "hand-written",
            "handwritten",
          ];
          if (creativeKeywords.some((kw) => lowerPrompt.includes(kw))) {
            lines.push(
              `Tip: Your prompt mentions a creative style. For best results with non-standard aesthetics, ` +
                `set style: "creative" to remove the professional SaaS constraints (white bg, fixed palette, sans-serif fonts).`,
            );
          }
        }

        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text: lines.join("\n") }];

        if (inlineImages && result.imageData) {
          content.push({
            type: "image",
            data: result.imageData.toString("base64"),
            mimeType: result.mimeType ?? "image/png",
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
    },
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
          path.extname(last.lastOutputPath),
        );
        const dir = path.dirname(last.lastOutputPath);
        const refinedPath = path.join(
          dir,
          `${baseName}_refined_${randomUUID().slice(0, 8)}`,
        );

        const result = await client.refine(
          last.lastPrompt,
          refinement,
          refinedPath,
          {
            type: last.lastType,
            aspectRatio: last.aspectRatio,
            size: last.size,
            style: last.style,
          },
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
          style: last.style,
        };

        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [
          { type: "text", text: `Refined image saved: ${result.outputPath}` },
        ];

        if (inlineImages && result.imageData) {
          content.push({
            type: "image",
            data: result.imageData.toString("base64"),
            mimeType: result.mimeType ?? "image/png",
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
    },
  );

  server.tool(
    "prepare_image",
    "Get guidance before generating an image. Call this FIRST to understand supported parameters, get prompt recommendations, and receive a polished prompt. This avoids rejected generations and wasted API calls.",
    PrepareImageSchema.shape,
    async ({ prompt, type }) => {
      const supportedTypes = Object.entries(DIAGRAM_TYPES).map(
        ([name, config]) =>
          `  - ${name}: ${config.composition} (default aspect: ${config.aspectRatio})`,
      );

      const supportedRatios = Object.keys(ASPECT_RATIO_VALUES).join(", ");

      const sections: string[] = [
        "=== GEMINI IMAGE GENERATION GUIDE ===",
        "",
        "SUPPORTED TYPES:",
        ...supportedTypes,
        "",
        `SUPPORTED ASPECT RATIOS: ${supportedRatios}`,
        "  Tip: Let the type auto-select the ratio, or override with aspect_ratio parameter.",
        "",
        "STYLE MODES:",
        "  - professional (default): Enforces clean SaaS aesthetic — white background, standard palette, sans-serif fonts",
        "  - creative: Removes aesthetic constraints — your prompt drives the look (vintage, retro, dark, artistic, watercolor, etc.)",
        "  Tip: Use 'creative' when you want non-standard visuals like vintage posters, hand-drawn sketches, or dark themes.",
        "",
        "SUPPORTED SIZES: 1K, 2K (default), 4K",
        "  - 1K: ~1024px longest side (fast, lightweight)",
        "  - 2K: ~2048px longest side (good balance)",
        "  - 4K: ~4096px longest side (high-res, may be capped by API for complex prompts)",
        "",
        "PROMPT BEST PRACTICES:",
        "  - Be specific about data, labels, and structure",
        "  - Describe the content, not the style (styling is handled automatically)",
        "  - Include actual text/labels you want rendered",
        "  - For charts: specify data points, axis labels, legend items",
        "  - For flows: list the steps/stages explicitly",
        "  - For architecture: name the components and their connections",
        "  - Keep prompts focused — overly complex prompts may cause dimension/quality issues",
        "",
        "WHAT TO AVOID:",
        "  - In 'professional' mode: Do NOT specify colors, fonts, or visual styling (the system prompt handles this)",
        "  - In 'professional' mode: Do NOT request dark backgrounds (white/light backgrounds are enforced)",
        "  - In 'creative' mode: You CAN specify any styling — colors, fonts, backgrounds, artistic effects",
        "  - Do NOT use aspect ratio 2:1 (use 16:9 instead)",
        "  - Do NOT request extremely complex layouts in a single image",
        "  - Do NOT include instructions like 'make it pretty' — focus on content",
        "",
        "ARCHITECTURE & FLOW DIAGRAM TIPS:",
        "  - Name specific technologies (e.g., 'PostgreSQL', 'Redis', 'Kubernetes') so the",
        "    model can apply appropriate shape hints (cylinders, pipes, nested boxes, etc.)",
        "  - Describe containment relationships (e.g., 'containers running inside a K8s pod')",
        "  - Specify connection types: sync/async, protocol (REST, gRPC, pub/sub)",
        "  - Mention data stores separately from compute — they render as different shapes",
        "  - Group components by layer (ingress, application, data, external)",
        "  - Shape vocabulary is auto-injected for architecture/flow types:",
        "    cylinders for databases, pipes for queues, nested boxes for containers,",
        "    diamonds for load balancers, cloud silhouettes for cloud services",
        "",
        "COMIC / VISUAL STORY PATTERN (for multi-image storytelling):",
        "  When the user asks for a story, comic, or sequence of images that tell a narrative:",
        "",
        "  STOCK CHARACTER — use this exact description in EVERY panel prompt:",
        "    Name: Alex",
        "    Appearance: short dark hair, round glasses, plain gray hoodie, jeans",
        "    Rules: Restate the FULL appearance line verbatim in every panel prompt.",
        "    DO NOT add accessories, logos, stickers, or props to the character — small",
        "    details mutate across panels and break visual continuity. Keep traits broad",
        "    and reproducible (hair style, glasses shape, clothing color/type).",
        "    If the user supplies a different character description, apply the same rules:",
        "    use only broad strokes, restate verbatim every panel, no fine details.",
        "",
        "  STORY STRUCTURE:",
        "  1. PLAN the full story arc FIRST — define all panels before generating any image",
        "  2. Follow the 3-act structure:",
        "     - Panel 1 (Setup/Problem): Introduce Alex + conflict. style: creative",
        "     - Panel 2 (Escalation/Context): Deepen the problem or show failed alternatives",
        "     - Panel 3+ (Solution): The fix. Keep style: creative for comic consistency",
        "     - Final panel (Resolution): The outcome/victory. Same character, same traits",
        "  3. GENERATE ONE PANEL AT A TIME — review each before generating the next",
        "  4. Each panel prompt MUST include:",
        "     a. Art style preamble (copy verbatim across all panels):",
        "        'Comic book panel, bold black outlines, flat vibrant colors, halftone dot",
        "         shading, thick black comic panel border frame. Same comic art style as a",
        "         comic strip series.'",
        "     b. Character description (restate verbatim: 'Developer Alex — short dark hair,",
        "        round glasses, plain gray hoodie')",
        "     c. Scene setting and mood",
        "     d. Speech/thought bubbles with actual dialogue text",
        "     e. Panel number/title banner for continuity",
        "  5. Use the SAME aspect_ratio across all panels (16:9 recommended for comic strips)",
        "  6. Comic style tips for creative mode:",
        "     - Bold black outlines, flat colors, halftone dots for classic comic feel",
        "     - Sound effects as stylized text (CRASH!, BEEP!, ZAP!)",
        "     - Motion lines, speed streaks, emphasis bursts for action",
        "     - Consistent panel border style (thick black frame)",
        "",
        "  CHARACTER CONSISTENCY RULES (critical):",
        "     - NEVER add small text on clothing (logos, slogans, stickers) — they mutate",
        "     - NEVER change hair style, glasses, or clothing between panels",
        "     - Use the same background elements (room furniture, desk items) when the scene",
        "       location repeats across panels",
        "     - Keep color palette consistent: same hoodie gray, same skin tone wording",
      ];

      if (prompt) {
        const analysis = analyzePrompt(prompt, {
          type: type && type !== "auto" ? type : undefined,
        });

        const {
          prompt: polished,
          aspectRatio,
          diagramType,
        } = buildPromptFromContext(prompt, {
          type: type && type !== "auto" ? type : undefined,
          aspectRatio: analysis.recommendedAspectRatio,
          size: analysis.recommendedSize,
        });

        sections.push(
          "",
          "=== ANALYSIS OF YOUR PROMPT ===",
          `Detected type: ${analysis.recommendedType}`,
          `Recommended aspect ratio: ${analysis.recommendedAspectRatio}`,
          `Recommended size: ${analysis.recommendedSize}`,
        );

        if (analysis.suggestions && analysis.suggestions.length > 0) {
          sections.push(`Notes: ${analysis.suggestions.join(". ")}`);
        }

        if (!analysis.shouldProceed && analysis.clarifyingQuestion) {
          sections.push(
            "",
            "CLARIFICATION NEEDED:",
            analysis.clarifyingQuestion,
          );
        }

        // Detect if prompt suggests creative style
        const lowerForStyle = prompt.toLowerCase();
        const creativeHints = [
          "vintage",
          "retro",
          "hand-drawn",
          "sketch",
          "watercolor",
          "artistic",
          "dark theme",
          "dark mode",
          "neon",
          "grunge",
          "minimalist art",
          "pastel",
          "sepia",
          "old-fashioned",
          "rustic",
          "elegant",
          "gothic",
          "comic",
          "cartoon",
          "antique",
          "distressed",
          "steampunk",
          "cyberpunk",
          "noir",
          "impressionist",
          "abstract art",
          "comic book",
          "comic panel",
          "manga",
          "graphic novel",
          "story panel",
          "speech bubble",
          "whiteboard",
          "marker",
          "hand-written",
          "handwritten",
        ];
        const recommendedStyle = creativeHints.some((kw) =>
          lowerForStyle.includes(kw),
        )
          ? "creative"
          : "professional";

        // Detect comic/story intent and build a ready-to-use prompt
        const comicKeywords = [
          "comic",
          "comic book",
          "comic panel",
          "manga",
          "graphic novel",
          "story panel",
          "cartoon",
          "speech bubble",
          "comic strip",
        ];
        const isComicIntent = comicKeywords.some((kw) =>
          lowerForStyle.includes(kw),
        );

        if (isComicIntent) {
          const comicPrompt =
            `Comic book panel, bold black outlines, flat vibrant colors, halftone dot shading, ` +
            `thick black comic panel border frame. Same comic art style as a comic strip series. ` +
            `Developer Alex — short dark hair, round glasses, plain gray hoodie. ` +
            prompt;

          sections.push(
            "",
            "=== COMIC MODE DETECTED ===",
            "Your prompt has been enriched with the stock character (Alex) and comic art style preamble.",
            "",
            "READY-TO-USE PROMPT (copy this into generate_image):",
            `  "${comicPrompt}"`,
            "",
            "INSTRUCTIONS FOR THE CALLING AGENT:",
            "  1. Use the ready-to-use prompt above as-is for generate_image",
            "  2. For multi-panel stories, restate the character line verbatim in every panel:",
            "     'Developer Alex — short dark hair, round glasses, plain gray hoodie'",
            "  3. DO NOT add logos, stickers, or text on clothing — they mutate across panels",
            "  4. Keep the art style preamble identical across all panels for visual consistency",
            "  5. Use style: creative, aspect_ratio: 16:9 for all comic panels",
            "",
            "=== RECOMMENDED CALL ===",
            "Call generate_image with:",
            `  prompt: "${comicPrompt}"`,
            `  type: "hero"`,
            `  aspect_ratio: "16:9"`,
            `  size: "${analysis.recommendedSize}"`,
            `  style: "creative"`,
          );
        } else {
          sections.push(
            "",
            "=== RECOMMENDED CALL ===",
            "Call generate_image with:",
            `  prompt: "${prompt}"`,
            `  type: "${diagramType}"`,
            `  aspect_ratio: "${aspectRatio}"`,
            `  size: "${analysis.recommendedSize}"`,
            `  style: "${recommendedStyle}"`,
          );

          if (recommendedStyle === "creative") {
            sections.push(
              "",
              "Note: Creative style detected — aesthetic constraints (white bg, SaaS palette) will be removed.",
              "Your prompt will drive the visual style directly.",
            );
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: sections.join("\n") }],
      };
    },
  );

  return server;
}
