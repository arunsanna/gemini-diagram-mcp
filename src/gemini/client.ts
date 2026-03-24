/**
 * Gemini Image Generation Client
 *
 * Uses gemini-3-pro-image-preview with native image generation
 * Same approach as ~/bin/gemini-image-gen
 */

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  enforceVertexAiMode,
  getVertexApiKeyFromEnv,
  getVertexImageModel,
} from "../runtime.js";

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Retry with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on certain errors
      const message = lastError.message.toLowerCase();
      if (
        message.includes("invalid api key") ||
        message.includes("quota") ||
        message.includes("permission denied")
      ) {
        throw lastError;
      }

      // Exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87A_SIGNATURE = Buffer.from("GIF87a", "ascii");
const GIF89A_SIGNATURE = Buffer.from("GIF89a", "ascii");
const RIFF_SIGNATURE = Buffer.from("RIFF", "ascii");
const WEBP_SIGNATURE = Buffer.from("WEBP", "ascii");

type ImageFormat = {
  mimeType: string;
  extension: string;
};

const IMAGE_FORMATS: ImageFormat[] = [
  { mimeType: "image/png", extension: ".png" },
  { mimeType: "image/jpeg", extension: ".jpg" },
  { mimeType: "image/webp", extension: ".webp" },
  { mimeType: "image/gif", extension: ".gif" },
];

function normalizeMimeType(mimeType: string | undefined): string | undefined {
  return mimeType?.split(";")[0]?.trim().toLowerCase();
}

function detectImageFormat(data: Buffer): ImageFormat | null {
  if (
    data.length >= PNG_SIGNATURE.length &&
    data.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    return IMAGE_FORMATS[0];
  }

  if (
    data.length >= JPEG_SIGNATURE.length &&
    data.subarray(0, 3).equals(JPEG_SIGNATURE)
  ) {
    return IMAGE_FORMATS[1];
  }

  if (
    data.length >= 12 &&
    data.subarray(0, 4).equals(RIFF_SIGNATURE) &&
    data.subarray(8, 12).equals(WEBP_SIGNATURE)
  ) {
    return IMAGE_FORMATS[2];
  }

  if (
    data.length >= GIF87A_SIGNATURE.length &&
    (data.subarray(0, 6).equals(GIF87A_SIGNATURE) ||
      data.subarray(0, 6).equals(GIF89A_SIGNATURE))
  ) {
    return IMAGE_FORMATS[3];
  }

  return null;
}

function formatFromMimeType(mimeType: string | undefined): ImageFormat | null {
  const normalized = normalizeMimeType(mimeType);
  return IMAGE_FORMATS.find((format) => format.mimeType === normalized) ?? null;
}

/**
 * Extract pixel dimensions from a PNG or JPEG buffer.
 */
function getImageDimensions(
  data: Buffer,
): { width: number; height: number } | null {
  // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian in IHDR chunk)
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    return { width, height };
  }

  // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
  if (data.length >= 4 && data.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    let offset = 2;
    while (offset < data.length - 9) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1];
      // SOF0 or SOF2
      if (marker === 0xc0 || marker === 0xc2) {
        const height = data.readUInt16BE(offset + 5);
        const width = data.readUInt16BE(offset + 7);
        return { width, height };
      }
      // Skip to next marker
      const segLen = data.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }

  return null;
}

// Expected minimum pixel width for each size tier
const SIZE_MIN_PIXELS: Record<string, number> = {
  "1K": 900,
  "2K": 1800,
  "4K": 3600,
};

// Supported aspect ratios and their numeric values
export const ASPECT_RATIO_VALUES: Record<string, number> = {
  "1:1": 1,
  "2:3": 2 / 3,
  "3:2": 3 / 2,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "9:16": 9 / 16,
  "16:9": 16 / 9,
  "21:9": 21 / 9,
};

function resolveOutputPathForFormat(
  outputPath: string,
  format: ImageFormat,
): string {
  const parsed = path.parse(outputPath);

  if (parsed.ext.toLowerCase() === format.extension) {
    return outputPath;
  }

  return path.join(
    parsed.dir,
    `${parsed.name || parsed.base}${format.extension}`,
  );
}

export type StyleMode = "professional" | "creative";

// Generation options
export interface GenerateOptions {
  type?: string;
  aspectRatio?: string;
  size?: string;
  style?: StyleMode;
}

// Result from image generation
export interface GenerationResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  textResponse?: string;
  aspectRatio?: string;
  imageData?: Buffer;
  mimeType?: string;
  actualWidth?: number;
  actualHeight?: number;
  requestedSize?: string;
  requestedAspectRatio?: string;
  dimensionWarning?: string;
}

// ============================================================================
// DIAGRAM TYPES - Auto aspect-ratio and composition hints
// ============================================================================

export const DIAGRAM_TYPES: Record<
  string,
  { aspectRatio: string; composition: string }
> = {
  chart: {
    aspectRatio: "16:9",
    composition: "Data visualization with clear labels, axes if needed, legend",
  },
  comparison: {
    aspectRatio: "16:9",
    composition: "Side-by-side panels, clear contrast between options",
  },
  flow: {
    aspectRatio: "16:9",
    composition:
      "Sequential stages connected by arrows, left-to-right or top-to-bottom. " +
      "Use distinct shapes for different step types (decision diamonds, process rectangles, " +
      "I/O parallelograms). Differentiate arrow styles: solid for main flow, dashed for " +
      "optional/error paths. Include small icons inside steps when technologies are named.",
  },
  architecture: {
    aspectRatio: "4:3",
    composition:
      "Layered system diagram with distinct shapes for different component types. " +
      "Group related components with subtle background cards. " +
      "Differentiate arrow styles: solid for sync, dashed for async. " +
      "Primary services should be visually larger than supporting infrastructure.",
  },
  timeline: {
    aspectRatio: "16:9",
    composition: "Horizontal progression with milestones, dates/phases marked",
  },
  hierarchy: {
    aspectRatio: "4:3",
    composition: "Tree structure, parent-child relationships, org chart style",
  },
  matrix: {
    aspectRatio: "1:1",
    composition: "Grid layout, 2x2 or larger, quadrants with labels",
  },
  hero: {
    aspectRatio: "16:9",
    composition: "Abstract visual, no text, atmospheric, brand-focused",
  },
  visualization: {
    aspectRatio: "16:9",
    composition: "Process or data visualization with clear flow",
  },
};

// Type detection keywords
const TYPE_KEYWORDS: Record<string, string[]> = {
  comparison: [
    "comparison",
    "compare",
    "vs",
    "versus",
    "before after",
    "before/after",
    "old new",
    "old/new",
    "difference",
    "improvement",
    "baseline",
  ],
  flow: [
    "flow",
    "process",
    "steps",
    "workflow",
    "pipeline",
    "sequence",
    "journey",
    "procedure",
    "→",
    "->",
    "then",
    "next",
  ],
  architecture: [
    "architecture",
    "system",
    "infrastructure",
    "layers",
    "components",
    "stack",
    "design",
    "structure",
    "diagram",
  ],
  timeline: [
    "timeline",
    "roadmap",
    "phases",
    "milestones",
    "history",
    "evolution",
    "schedule",
    "plan",
  ],
  hierarchy: [
    "hierarchy",
    "org chart",
    "organization",
    "tree",
    "taxonomy",
    "parent child",
    "inheritance",
  ],
  matrix: [
    "matrix",
    "grid",
    "table",
    "features",
    "pricing",
    "tiers",
    "plans",
    "quadrant",
    "2x2",
  ],
  chart: [
    "chart",
    "graph",
    "data",
    "metrics",
    "statistics",
    "analytics",
    "bar",
    "line",
    "pie",
    "progress",
  ],
  hero: ["hero", "header", "banner", "cover", "abstract", "visual"],
  visualization: ["visualization", "infographic", "overview", "summary"],
};

// ============================================================================
// SYSTEM PROMPT - Consistent styling for all generated images
// ============================================================================

// Base rules applied to ALL styles (sharpness + watermark)
const BASE_PROMPT_PROFESSIONAL = `RENDERING QUALITY:
- Ultra-sharp edges on all text, lines, icons, and shapes — no blur or anti-aliasing artifacts
- Crisp 1px borders where borders are used; never fuzzy or semi-transparent
- All text must be pixel-perfect, fully legible, and never truncated or overlapping
- High-contrast rendering: foreground elements must stand out clearly from backgrounds
- Vector-quality appearance: clean geometry, precise alignment, no rasterization noise

WATERMARK — THIS IS REQUIRED, DO NOT SKIP:
- You MUST render the text "arunsanna.com" in the bottom-right corner of the image
- Use light gray color (#94a3b8), small font size (about 10pt), slightly transparent
- Position it with a small margin from the bottom and right edges
- This watermark must appear on EVERY generated image without exception`;

const BASE_PROMPT_CREATIVE = `RENDERING QUALITY:
- All text must be legible and never truncated or overlapping
- Clean geometry and precise alignment appropriate to the chosen artistic style

WATERMARK — THIS IS REQUIRED, DO NOT SKIP:
- You MUST render the text "arunsanna.com" in the bottom-right corner of the image
- Use a subtle color that contrasts with the background (light on dark, dark on light), small font size (about 10pt), slightly transparent
- Position it with a small margin from the bottom and right edges
- This watermark must appear on EVERY generated image without exception`;

// Professional aesthetic — only applied when style === "professional"
const PROFESSIONAL_STYLE_PROMPT = `BACKGROUND REQUIREMENTS:
- Primary background: Clean white (#ffffff) or very light gray (#f8fafc)
- Secondary backgrounds: Light gray (#f1f5f9) for cards/containers
- NO dark backgrounds - images must work on white web pages
- Subtle shadows for depth instead of dark containers

TYPOGRAPHY REQUIREMENTS:
- Primary font: Clean sans-serif (Inter, SF Pro, or Helvetica Neue style)
- Text color: Dark charcoal (#1e293b) for primary text
- Secondary text: Medium gray (#64748b)
- Headlines: Bold weight, tight letter-spacing
- Numbers/Data: Tabular figures, medium weight
- NO decorative, script, or novelty fonts
- Minimum font size equivalent to 14pt for readability
- All text must be sharp and crisp, never blurry or pixelated

COLOR PALETTE:
- Background: White #ffffff or light gray #f8fafc
- Cards/Containers: Light gray #f1f5f9 with subtle borders
- Primary accent: Blue #3b82f6
- Success: Green #22c55e
- Warning: Amber #f59e0b
- Danger: Red #ef4444
- Text: Dark charcoal #1e293b
- Borders: Light gray #e2e8f0

STYLE:
- Modern, clean, minimal SaaS aesthetic
- Light and airy feel
- Subtle drop shadows (not harsh)
- Consistent 8px or 16px spacing
- Rounded corners (8-12px radius)
- Professional enterprise look
- Works seamlessly on white web pages`;

function getStylePrompt(style?: StyleMode): string {
  if (style === "creative") {
    return BASE_PROMPT_CREATIVE;
  }
  return `${PROFESSIONAL_STYLE_PROMPT}\n\n${BASE_PROMPT_PROFESSIONAL}`;
}

// Detection result with confidence
export interface TypeDetection {
  type: string;
  confidence: "high" | "medium" | "low";
  alternativeTypes: string[];
  reasoning: string;
}

/**
 * Detect diagram type from prompt with confidence scoring
 */
export function detectType(prompt: string): string {
  return detectTypeWithConfidence(prompt).type;
}

/**
 * Detect diagram type with confidence and alternatives
 */
export function detectTypeWithConfidence(prompt: string): TypeDetection {
  const lower = prompt.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [dtype, keywords] of Object.entries(TYPE_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        score += keyword.split(" ").length;
      }
    }
    scores[dtype] = score;
  }

  // Sort by score descending
  const sorted = Object.entries(scores)
    .filter(([_, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  // No matches - low confidence default
  if (sorted.length === 0) {
    return {
      type: "visualization",
      confidence: "low",
      alternativeTypes: ["chart", "flow", "architecture"],
      reasoning:
        "No specific type keywords found. Consider specifying: chart, flow, architecture, comparison, timeline, hierarchy, or matrix.",
    };
  }

  const [topType, topScore] = sorted[0];
  const alternatives = sorted.slice(1, 4).map(([t]) => t);

  // Check for competing types (close scores)
  const hasCompetition = sorted.length > 1 && sorted[1][1] >= topScore * 0.7;

  // Determine confidence
  let confidence: "high" | "medium" | "low";
  let reasoning: string;

  if (topScore >= 3 && !hasCompetition) {
    confidence = "high";
    reasoning = `Strong match for ${topType} based on keywords.`;
  } else if (topScore >= 2 || (topScore >= 1 && !hasCompetition)) {
    confidence = "medium";
    reasoning = `Detected ${topType}${alternatives.length > 0 ? `, but could also be ${alternatives.slice(0, 2).join(" or ")}` : ""}.`;
  } else {
    confidence = "low";
    reasoning = `Weak signal for ${topType}. ${alternatives.length > 0 ? `Consider: ${alternatives.join(", ")}` : ""}`;
  }

  return {
    type: topType,
    confidence,
    alternativeTypes: alternatives,
    reasoning,
  };
}

/**
 * Analyze prompt and provide smart recommendations or questions
 */
export interface PromptAnalysis {
  shouldProceed: boolean;
  recommendedType: string;
  recommendedAspectRatio: string;
  recommendedSize: string;
  clarifyingQuestion?: string;
  suggestions?: string[];
}

export function analyzePrompt(
  prompt: string,
  options: GenerateOptions = {},
): PromptAnalysis {
  const detection = detectTypeWithConfidence(prompt);
  const typeConfig = DIAGRAM_TYPES[detection.type] || DIAGRAM_TYPES.chart;

  // Check for size hints in prompt — only when caller did not specify an explicit size
  const lower = prompt.toLowerCase();
  let recommendedSize = options.size || "2K";
  if (!options.size) {
    if (
      lower.includes("presentation") ||
      lower.includes("slide") ||
      lower.includes("4k") ||
      lower.includes("high res")
    ) {
      recommendedSize = "4K";
    } else if (
      lower.includes("thumbnail") ||
      lower.includes("small") ||
      lower.includes("preview")
    ) {
      recommendedSize = "1K";
    }
  }

  // Check for aspect ratio hints — only when caller did not specify an explicit ratio
  let recommendedAspectRatio = options.aspectRatio || typeConfig.aspectRatio;
  if (!options.aspectRatio) {
    if (lower.includes("square")) {
      recommendedAspectRatio = "1:1";
    } else if (
      lower.includes("wide") ||
      lower.includes("banner") ||
      lower.includes("header")
    ) {
      recommendedAspectRatio = "16:9";
    } else if (
      lower.includes("portrait") ||
      lower.includes("mobile") ||
      lower.includes("story")
    ) {
      recommendedAspectRatio = "9:16";
    }
  }

  // Build analysis result
  const analysis: PromptAnalysis = {
    shouldProceed: true,
    recommendedType:
      options.type && options.type !== "auto" ? options.type : detection.type,
    recommendedAspectRatio,
    recommendedSize,
  };

  // Generate clarifying questions for low confidence
  if (detection.confidence === "low" && !options.type) {
    analysis.shouldProceed = false;
    analysis.clarifyingQuestion = `I'm not certain about the best visualization type. ${detection.reasoning}\n\nWhat type would you prefer?\n${Object.keys(
      DIAGRAM_TYPES,
    )
      .map((t) => `- ${t}: ${DIAGRAM_TYPES[t].composition.split(",")[0]}`)
      .join("\n")}`;
  }

  // Provide suggestions for medium confidence
  if (detection.confidence === "medium" && !options.type) {
    analysis.suggestions = [
      `Detected: ${detection.type} (${detection.confidence} confidence)`,
      ...detection.alternativeTypes.map((t) => `Alternative: ${t}`),
    ];
  }

  return analysis;
}

// Visual vocabulary and connection styles — only injected for architecture/flow types
const TECHNICAL_DIAGRAM_PROMPT = `
VISUAL VOCABULARY:
- Databases/data stores: Use cylinder shapes (NOT rectangles)
- Message queues/event buses: Use horizontal pipe or arrow-through-rectangle icons
- Load balancers/ingress: Use a splitting-arrows or fan-out diamond shape
- Cloud services: Use cloud silhouettes
- Containers/pods: Use nested box-in-box to show containment relationships
- APIs/endpoints: Use a hexagonal gateway shape
- Users/clients: Use a person silhouette or browser window icon
- Caches: Use a cylinder with a lightning bolt overlay
- NEVER render everything as plain rectangles — vary shapes to convey function
- Use at least 3 distinct shape types
- Primary services should be visually larger/bolder than supporting infrastructure

CONNECTION STYLES:
- Solid arrows: synchronous request/response
- Dashed arrows: asynchronous or event-driven communication
- Thick arrows: high-throughput data paths
- Thin arrows: control/management plane
- Label arrows with protocol or action when relevant (e.g., "REST", "gRPC", "pub/sub")
- Use arrowhead direction to show data/request flow
`;

// Shape hints: each entry has a regex pattern (word-boundary safe), a shape
// category (for deduplication), and the rendering instruction.
const COMPONENT_SHAPE_HINTS: Array<{
  pattern: RegExp;
  category: string;
  hint: string;
}> = [
  // Databases — cylinder shape
  {
    pattern: /\b(database|datastore|data store)\b/i,
    category: "database",
    hint: "render databases as cylinder shapes",
  },
  {
    pattern: /\b(postgres|postgresql|mysql|mariadb)\b/i,
    category: "database",
    hint: "render as a cylinder with a recognizable database icon",
  },
  {
    pattern: /\b(mongo|mongodb|dynamodb|cassandra)\b/i,
    category: "database",
    hint: "render as a cylinder with a recognizable database icon",
  },
  {
    pattern: /\b(redis)\b/i,
    category: "cache-db",
    hint: "render Redis as a cylinder with a cache/speed icon overlay",
  },
  {
    pattern: /\b(elasticsearch|opensearch)\b/i,
    category: "database",
    hint: "render as a cylinder with a search icon overlay",
  },

  // Message queues — pipe shape
  {
    pattern: /\b(queue|message queue|event bus)\b/i,
    category: "queue",
    hint: "render queues as a horizontal pipe with arrow icon",
  },
  {
    pattern: /\b(kafka|rabbitmq|sqs|nats|pulsar)\b/i,
    category: "queue",
    hint: "render as a horizontal pipe icon representing a message queue",
  },

  // Load balancers
  {
    pattern: /\b(load balancer|lb|ingress)\b/i,
    category: "lb",
    hint: "render as a splitting-arrows diamond shape",
  },
  {
    pattern: /\b(nginx|haproxy|envoy|traefik)\b/i,
    category: "lb",
    hint: "render as a gateway/proxy diamond shape",
  },

  // Containers / orchestration
  {
    pattern: /\b(kubernetes|k8s)\b/i,
    category: "k8s",
    hint: "render with a container orchestration icon, use nested boxes for pods",
  },
  {
    pattern: /\b(docker)\b/i,
    category: "container",
    hint: "render with a container icon, use nested box for containerized services",
  },
  {
    pattern: /\b(container)\b/i,
    category: "container",
    hint: "render as a nested box-in-box",
  },
  {
    pattern: /\b(pod)\b/i,
    category: "pod",
    hint: "render as a nested box group with multiple containers inside",
  },

  // Cloud providers
  {
    pattern: /\baws\b/i,
    category: "cloud",
    hint: "render AWS services with cloud silhouette icons",
  },
  {
    pattern: /\b(gcp|google cloud)\b/i,
    category: "cloud",
    hint: "render GCP services with cloud silhouette icons",
  },
  {
    pattern: /\b(azure)\b/i,
    category: "cloud",
    hint: "render Azure services with cloud silhouette icons",
  },

  // Specific cloud services
  {
    pattern: /\bs3\b/i,
    category: "storage",
    hint: "render S3 as a bucket/storage shape",
  },
  {
    pattern: /\b(lambda|cloud function|serverless)\b/i,
    category: "serverless",
    hint: "render serverless functions with a function/event icon",
  },

  // Caches
  {
    pattern: /\b(cache|memcached)\b/i,
    category: "cache",
    hint: "render as a cylinder with a lightning bolt overlay",
  },
  {
    pattern: /\bcdn\b/i,
    category: "cdn",
    hint: "render as a globe/network distribution icon",
  },

  // APIs / gateways
  {
    pattern: /\b(api gateway|api)\b/i,
    category: "api",
    hint: "render as a hexagonal gateway shape",
  },

  // Users / clients
  {
    pattern: /\b(user|end user)\b/i,
    category: "user",
    hint: "render as a person silhouette icon",
  },
  {
    pattern: /\b(browser|web client)\b/i,
    category: "client",
    hint: "render as a browser window icon",
  },

  // Monitoring
  {
    pattern: /\b(prometheus|grafana|datadog|monitoring)\b/i,
    category: "monitoring",
    hint: "render with a dashboard/chart mini-icon",
  },

  // Infrastructure as code
  {
    pattern: /\b(terraform|pulumi)\b/i,
    category: "iac",
    hint: "render with an infrastructure-as-code icon",
  },
];

function detectShapeHints(prompt: string): string[] {
  const seen = new Set<string>();
  const hints: string[] = [];
  for (const { pattern, category, hint } of COMPONENT_SHAPE_HINTS) {
    if (seen.has(category)) continue;
    if (pattern.test(prompt)) {
      seen.add(category);
      hints.push(`- ${hint}`);
    }
  }
  return hints;
}

// Resolution map for size parameter
const SIZE_MAP: Record<string, string> = {
  "1K": "approximately 1024 pixels on the longest side",
  "2K": "approximately 2048 pixels on the longest side",
  "4K": "approximately 4096 pixels on the longest side",
};

/**
 * Build prompt from natural language context
 */
export function buildPromptFromContext(
  context: string,
  options: {
    type?: string;
    aspectRatio?: string;
    size?: string;
    style?: StyleMode;
  } = {},
): { prompt: string; aspectRatio: string; diagramType: string } {
  const diagramType = options.type || detectType(context);
  const typeConfig = DIAGRAM_TYPES[diagramType] || DIAGRAM_TYPES.chart;
  const aspectRatio = options.aspectRatio || typeConfig.aspectRatio;
  const sizeDesc = SIZE_MAP[options.size || "2K"] || SIZE_MAP["2K"];

  // Inject visual vocabulary + shape hints only for architecture/flow types
  const isTechnical = diagramType === "architecture" || diagramType === "flow";
  let technicalBlock = "";
  if (isTechnical) {
    const hints = detectShapeHints(context);
    const hintsSection =
      hints.length > 0
        ? `\nCOMPONENT-SPECIFIC VISUAL TREATMENT:\n${hints.join("\n")}\n`
        : "";
    technicalBlock = `${TECHNICAL_DIAGRAM_PROMPT}${hintsSection}`;
  }

  const stylePrompt = getStylePrompt(options.style);
  const styleLabel = options.style === "creative" ? "" : " professional";

  const importantLines = [
    "- Make the visualization clear and immediately understandable",
    `- Maintain the specified ${aspectRatio} aspect ratio precisely`,
    '- MANDATORY: Include "arunsanna.com" watermark text in the bottom-right corner (light gray, small, subtle)',
  ];
  if (options.style !== "creative") {
    importantLines.unshift(
      "- Follow the design system exactly (white background, SaaS aesthetic)",
      "- Use the standard color palette for data representation",
    );
  }

  const prompt = `Create a${styleLabel} ${diagramType} diagram.

CONTEXT:
${context}

COMPOSITION GUIDANCE:
${typeConfig.composition}
${technicalBlock}
IMAGE SPECIFICATIONS:
- Aspect ratio: ${aspectRatio}
- Resolution: High quality, ${sizeDesc}
- Format: PNG with clean edges

${stylePrompt}

IMPORTANT:
${importantLines.join("\n")}`;

  return { prompt, aspectRatio, diagramType };
}

/**
 * Gemini Image Generation Client
 * Uses gemini-3-pro-image-preview with native image generation
 */
export class GeminiImageClient {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey?: string) {
    const key = apiKey || getVertexApiKeyFromEnv();

    if (!key) {
      throw new Error(
        "VERTEX_AI_API_KEY, GOOGLE_API_KEY, or GOOGLE_CLOUD_API_KEY environment variable required for Vertex AI API-key mode",
      );
    }

    enforceVertexAiMode();
    this.model = getVertexImageModel();
    this.ai = new GoogleGenAI({
      vertexai: true,
      apiKey: key,
    });
  }

  /**
   * Generate an image from a prompt using native Gemini image generation
   */
  async generate(
    prompt: string,
    outputPath: string,
    options: GenerateOptions = {},
  ): Promise<GenerationResult> {
    try {
      // Ensure output directory exists
      const dir = path.dirname(outputPath);
      if (dir && dir !== ".") {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Build context-aware prompt with all options embedded
      const {
        prompt: enhancedPrompt,
        aspectRatio,
        diagramType,
      } = buildPromptFromContext(prompt, {
        type: options.type === "auto" ? undefined : options.type,
        aspectRatio: options.aspectRatio,
        size: options.size,
        style: options.style,
      });

      // Resolve size to valid imageSize value
      const imageSize = options.size || "2K";

      // Generate with retry logic
      const response = await withRetry(async () => {
        return this.ai.models.generateContent({
          model: this.model,
          contents: enhancedPrompt,
          config: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
              aspectRatio: aspectRatio,
              imageSize: imageSize,
            },
          },
        });
      });

      // Process response - extract image and text from parts
      let imageData: Buffer | null = null;
      let imageMimeType: string | undefined;
      let textResponse = "";

      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if ("inlineData" in part && part.inlineData?.data) {
          imageData = Buffer.from(part.inlineData.data, "base64");
          imageMimeType = normalizeMimeType(part.inlineData.mimeType);
        } else if ("text" in part && part.text) {
          textResponse += part.text;
        }
      }

      if (!imageData) {
        return {
          success: false,
          error:
            "No image generated" + (textResponse ? `: ${textResponse}` : ""),
        };
      }

      const detectedFormat = detectImageFormat(imageData);
      if (!detectedFormat) {
        return {
          success: false,
          error:
            "Generated data is not a supported image format" +
            (imageMimeType ? ` (${imageMimeType})` : ""),
        };
      }

      const declaredFormat = formatFromMimeType(imageMimeType);
      const finalFormat =
        declaredFormat?.mimeType === detectedFormat.mimeType
          ? declaredFormat
          : detectedFormat;
      const finalOutputPath = resolveOutputPathForFormat(
        outputPath,
        finalFormat,
      );

      // Extract actual dimensions
      const dims = getImageDimensions(imageData);
      const actualWidth = dims?.width ?? 0;
      const actualHeight = dims?.height ?? 0;

      // Validate aspect ratio
      const warnings: string[] = [];
      if (dims && aspectRatio) {
        const expectedRatio = ASPECT_RATIO_VALUES[aspectRatio];
        if (expectedRatio) {
          const actualRatio = actualWidth / actualHeight;
          const ratioDiff =
            Math.abs(actualRatio - expectedRatio) / expectedRatio;
          if (ratioDiff > 0.15) {
            const actualApprox = `${actualWidth}:${actualHeight}`;
            warnings.push(
              `Aspect ratio mismatch: requested ${aspectRatio} but received ~${actualApprox} (${actualWidth}x${actualHeight}px). ` +
                `Try a simpler prompt or a different aspect_ratio.`,
            );
          }
        }
      }

      // Validate size
      if (dims && imageSize) {
        const minPixels = SIZE_MIN_PIXELS[imageSize];
        const longestSide = Math.max(actualWidth, actualHeight);
        if (minPixels && longestSide < minPixels) {
          const actualTier =
            longestSide >= 3600 ? "4K" : longestSide >= 1800 ? "2K" : "1K";
          warnings.push(
            `Resolution mismatch: requested ${imageSize} (>=${minPixels}px) but received ${actualWidth}x${actualHeight}px (${actualTier}). ` +
              `The Gemini API may cap resolution for complex prompts. Try size="1K" or simplify the prompt.`,
          );
        }
      }

      // Prefer the actual bytes over the declared MIME type if they disagree.
      fs.writeFileSync(finalOutputPath, imageData);

      return {
        success: true,
        outputPath: path.resolve(finalOutputPath),
        textResponse: textResponse || undefined,
        aspectRatio: aspectRatio,
        imageData,
        mimeType: detectedFormat.mimeType,
        actualWidth,
        actualHeight,
        requestedSize: imageSize,
        requestedAspectRatio: aspectRatio,
        dimensionWarning:
          warnings.length > 0 ? warnings.join(" | ") : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Generation failed: ${message}`,
      };
    }
  }

  /**
   * Refine an existing image with modifications
   */
  async refine(
    originalPrompt: string,
    refinement: string,
    outputPath: string,
    options: GenerateOptions = {},
  ): Promise<GenerationResult> {
    const combinedPrompt = `${originalPrompt}

REFINEMENT REQUEST:
${refinement}

IMPORTANT: Keep the same overall design and content, only apply the requested changes.`;

    return this.generate(combinedPrompt, outputPath, options);
  }
}
