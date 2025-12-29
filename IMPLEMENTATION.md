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

MCP servers are stateless between calls. For refinement support:

1. **In-memory state** - Works for single session
2. **File-based state** - Persist to `~/.gemini-diagram-mcp/session.json`

```typescript
interface Session {
  lastPrompt: string;
  lastOutput: string;
  lastTimestamp: number;
}
```

## Implementation Status

**Approach**: Option B (Native TypeScript) was chosen for cleaner architecture.

- [x] Native TypeScript with `@google/genai` SDK
- [x] `generate_image` tool with type auto-detection
- [x] `refine_image` tool with session state
- [x] Session persistence in `~/.gemini-diagram-mcp/`
- [x] Professional prompt enhancement for each type
- [ ] Test with Claude Code
- [ ] Publish to npm
