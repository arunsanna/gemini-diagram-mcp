import { createRequire } from "node:module";

export const DEFAULT_VERTEX_IMAGE_MODEL = "gemini-3-pro-image-preview";

export function getPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getVertexApiKeyFromEnv(): string | undefined {
  return (
    process.env.VERTEX_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_CLOUD_API_KEY
  );
}

export function getVertexImageModel(): string {
  return process.env.VERTEX_AI_IMAGE_MODEL || DEFAULT_VERTEX_IMAGE_MODEL;
}

export function enforceVertexAiMode(): void {
  process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
}

export function assertVertexConfigPresent(): void {
  if (!getVertexApiKeyFromEnv()) {
    throw new Error(
      "VERTEX_AI_API_KEY, GOOGLE_API_KEY, or GOOGLE_CLOUD_API_KEY environment variable required for Vertex AI API-key mode"
    );
  }
}
