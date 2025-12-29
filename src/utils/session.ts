/**
 * Session Management for Image Refinement
 *
 * Persists state between MCP calls to support iterative refinement
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Session data structure
export interface Session {
  lastPrompt: string;
  lastOutput: string;
  lastType: string; // Diagram type (chart, comparison, flow, architecture, etc.)
  aspectRatio?: string; // Aspect ratio used
  size?: string; // Resolution (1K, 2K, 4K)
  timestamp: number;
}

// Session file location
const SESSION_DIR = path.join(os.homedir(), ".mcp-gemini-image");
const SESSION_FILE = path.join(SESSION_DIR, "session.json");

// Session expiry (1 hour)
const SESSION_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Ensure session directory exists
 */
function ensureSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

/**
 * Load current session from disk
 */
export function loadSession(): Session | null {
  try {
    if (!fs.existsSync(SESSION_FILE)) {
      return null;
    }

    const data = fs.readFileSync(SESSION_FILE, "utf-8");
    const session: Session = JSON.parse(data);

    // Check if session is expired
    if (Date.now() - session.timestamp > SESSION_EXPIRY_MS) {
      clearSession();
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Save session to disk
 */
export function saveSession(session: Omit<Session, "timestamp">): void {
  ensureSessionDir();

  const fullSession: Session = {
    ...session,
    timestamp: Date.now(),
  };

  fs.writeFileSync(SESSION_FILE, JSON.stringify(fullSession, null, 2));
}

/**
 * Clear session data
 */
export function clearSession(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Get session info for display
 */
export function getSessionInfo(): string | null {
  const session = loadSession();
  if (!session) {
    return null;
  }

  const age = Math.round((Date.now() - session.timestamp) / 1000 / 60);
  return `Last: "${session.lastPrompt.slice(0, 50)}..." → ${session.lastOutput} (${age}m ago)`;
}
