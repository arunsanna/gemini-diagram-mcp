/**
 * Gemini Image Generation Client
 *
 * Wrapper around @google/genai SDK for image generation
 */

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";

// Image generation configuration
export interface ImageConfig {
  numberOfImages?: number;
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
}

// Result from image generation
export interface GenerationResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

// Type detection keywords
const TYPE_KEYWORDS = {
  diagram: [
    "architecture",
    "flow",
    "sequence",
    "er",
    "class",
    "component",
    "system",
    "uml",
    "database",
    "network",
    "deployment",
  ],
  chart: [
    "chart",
    "graph",
    "bar",
    "pie",
    "line",
    "comparison",
    "metrics",
    "statistics",
    "data",
    "trend",
  ],
  visualization: [
    "process",
    "workflow",
    "pipeline",
    "timeline",
    "roadmap",
    "overview",
    "infographic",
  ],
};

/**
 * Detect image type from prompt
 */
export function detectType(
  prompt: string
): "diagram" | "chart" | "visualization" {
  const lower = prompt.toLowerCase();

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return type as "diagram" | "chart" | "visualization";
    }
  }

  return "diagram"; // Default
}

/**
 * Enhance prompt with professional styling based on type
 */
export function enhancePrompt(
  prompt: string,
  type: "diagram" | "chart" | "visualization" | "auto"
): string {
  const resolvedType = type === "auto" ? detectType(prompt) : type;

  const styleGuides: Record<string, string> = {
    diagram: `Create a professional technical diagram: ${prompt}.
Style: Clean lines, modern flat design, clear labels, professional color palette (blues, grays, accent colors).
Format: High contrast, suitable for documentation or presentations. White or light background.`,

    chart: `Create a professional data visualization chart: ${prompt}.
Style: Clear axis labels, legend, modern color scheme, readable fonts.
Format: Business-appropriate, clean design, suitable for reports. White background.`,

    visualization: `Create a professional process visualization: ${prompt}.
Style: Clear flow direction, numbered steps if applicable, modern icons, professional colors.
Format: Easy to follow, suitable for presentations or documentation. Clean white background.`,
  };

  return styleGuides[resolvedType];
}

/**
 * Gemini Image Generation Client
 */
export class GeminiImageClient {
  private client: GoogleGenAI;
  private model: string = "imagen-3.0-generate-002";

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!key) {
      throw new Error(
        "GEMINI_API_KEY or GOOGLE_API_KEY environment variable required"
      );
    }

    this.client = new GoogleGenAI({ apiKey: key });
  }

  /**
   * Generate an image from a prompt
   */
  async generate(
    prompt: string,
    outputPath: string,
    type: "diagram" | "chart" | "visualization" | "auto" = "auto",
    config: ImageConfig = {}
  ): Promise<GenerationResult> {
    try {
      // Ensure output directory exists
      const dir = path.dirname(outputPath);
      if (dir && dir !== ".") {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Enhance prompt with professional styling
      const enhancedPrompt = enhancePrompt(prompt, type);

      // Generate image
      const response = await this.client.models.generateImages({
        model: this.model,
        prompt: enhancedPrompt,
        config: {
          numberOfImages: config.numberOfImages || 1,
          aspectRatio: config.aspectRatio || "16:9",
        },
      });

      // Check for generated images
      if (!response.generatedImages || response.generatedImages.length === 0) {
        return {
          success: false,
          error: "No images generated - the prompt may have been blocked",
        };
      }

      // Save first image
      const imageData = response.generatedImages[0];
      if (!imageData.image?.imageBytes) {
        return {
          success: false,
          error: "Generated image has no data",
        };
      }

      const buffer = Buffer.from(imageData.image.imageBytes, "base64");
      fs.writeFileSync(outputPath, buffer);

      return {
        success: true,
        outputPath: path.resolve(outputPath),
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
    type: "diagram" | "chart" | "visualization" | "auto" = "auto"
  ): Promise<GenerationResult> {
    // Combine original prompt with refinement instructions
    const combinedPrompt = `${originalPrompt}

Additional modifications: ${refinement}`;

    return this.generate(combinedPrompt, outputPath, type);
  }
}
