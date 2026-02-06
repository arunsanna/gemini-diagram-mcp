import { createRequire } from "node:module";

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

export function getApiKeyFromEnv(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

export function assertApiKeyPresent(): void {
  if (!getApiKeyFromEnv()) {
    throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY environment variable required");
  }
}

