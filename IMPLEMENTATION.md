# Implementation Notes

## Reference: Existing CLI Tool

The existing `~/bin/gemini-image-gen` is a 2100+ line Python script with these key features:

### Core Capabilities
- Uses `google-genai` Python SDK
- Supports `GOOGLE_CLOUD_API_KEY` or `GOOGLE_API_KEY` env vars
- Session management for multi-turn refinement
- Presets for common diagram types
- Batch processing via YAML config

### Key Features to Port

1. **Session State** - Tracks last generated image for `--refine` support
2. **Smart Presets** - Pre-configured prompts for common diagram types
3. **Consistent Styling** - Professional output suitable for publications
4. **Batch Mode** - Process multiple images from config file

## MCP Implementation Strategy

### Option A: Wrap Existing Python Script
```typescript
// Call gemini-image-gen as subprocess
import { spawn } from 'child_process';

async function generateImage(prompt: string, output: string) {
  return new Promise((resolve, reject) => {
    const proc = spawn('gemini-image-gen', ['--prompt', prompt, '--output', output]);
    // ...
  });
}
```
**Pros**: Reuse battle-tested code, minimal rewrite
**Cons**: Requires Python installed, subprocess overhead

### Option B: Native TypeScript with @google/generative-ai
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Use imagen or gemini-pro-vision for generation
```
**Pros**: Pure Node.js, no Python dependency
**Cons**: May need to reimplement features, API differences

### Recommended: Option A (Initial), then Option B

1. **v0.1**: Wrap existing Python script for quick ship
2. **v0.2**: Port core logic to TypeScript for standalone operation

## Tool Definitions

### generate_image
```typescript
{
  name: "generate_image",
  description: "Generate a diagram, chart, or visualization using Gemini",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Natural language description of the image"
      },
      output: {
        type: "string",
        description: "Output filename (optional, auto-generated)"
      },
      type: {
        type: "string",
        enum: ["diagram", "chart", "visualization", "auto"],
        default: "auto"
      },
      preset: {
        type: "string",
        description: "Use a predefined style preset"
      }
    },
    required: ["prompt"]
  }
}
```

### refine_image
```typescript
{
  name: "refine_image",
  description: "Modify the last generated image",
  inputSchema: {
    type: "object",
    properties: {
      refinement: {
        type: "string",
        description: "Changes to apply to the last image"
      }
    },
    required: ["refinement"]
  }
}
```

## Session Persistence

Refinement (`refine_image`) requires the server to remember the last generated image within an MCP session/connection.

This project uses **in-memory per MCP connection** state:

```typescript
interface Session {
  lastPrompt: string;
  lastOutputPath: string;
  lastType: string;
  aspectRatio?: string;
  size?: string;
}
```

This is safe for centralized hosting (multi-tenant), but does not survive process restarts.

## Deployment Modes

The CLI supports three modes:

1. `gemini-diagram-mcp` (default): classic **stdio** MCP server
2. `gemini-diagram-mcp http`: centralized **HTTP** MCP server (Streamable HTTP `/mcp` plus optional legacy SSE)
3. `gemini-diagram-mcp proxy`: **stdio proxy** that forwards MCP tool calls to a centralized HTTP server

## Implementation Status

**Approach**: Option B (Native TypeScript) was chosen for cleaner architecture.

- [x] Native TypeScript with `@google/genai` SDK
- [x] `generate_image` tool with type auto-detection
- [x] `refine_image` tool with session state
- [x] Centralized HTTP server mode (Streamable HTTP + legacy SSE)
- [x] Required auth token for centralized mode (`MCP_AUTH_TOKEN`)
- [x] Stdio proxy mode (no API key on clients)
- [x] Professional prompt enhancement for each type
- [ ] Test with Claude Code
- [ ] Publish to npm
