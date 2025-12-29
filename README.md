# gemini-diagram-mcp

[![npm version](https://badge.fury.io/js/gemini-diagram-mcp.svg)](https://www.npmjs.com/package/gemini-diagram-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for generating diagrams, charts, and visualizations using Google Gemini's native image generation.

## Features

- **Smart Detection**: Auto-detects diagram type from prompt, asks clarifying questions when uncertain
- **Universal**: Works with Claude Code, Claude Desktop, Cursor, Windsurf, Cline, and any MCP client
- **Professional Styling**: Consistent SaaS aesthetic with proper typography and color palette
- **Configurable**: Aspect ratios (16:9, 1:1, 4:3, etc.) and resolutions (1K, 2K, 4K)
- **Robust**: Retry logic with exponential backoff, PNG validation
- **Iterative**: Refine last generated image without repeating full prompt

## Tools

| Tool | Description |
|------|-------------|
| `generate_image` | Generate diagram/chart/visualization from natural language |
| `refine_image` | Iteratively refine the last generated image |

### Parameters

**generate_image**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | required | Natural language description |
| `output` | string | auto | Output filename |
| `type` | enum | auto | `chart`, `comparison`, `flow`, `architecture`, `timeline`, `hierarchy`, `matrix`, `hero`, `visualization` |
| `aspect_ratio` | enum | auto | `16:9`, `1:1`, `4:3`, `3:4`, `9:16`, `2:1` |
| `size` | enum | 2K | `1K`, `2K`, `4K` |

**refine_image**
| Parameter | Type | Description |
|-----------|------|-------------|
| `refinement` | string | Description of changes to make |

## Installation

### 1. Get API Key

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

### 2. Configure Your Client

No build required - just use `npx`:

#### Claude Code

```bash
claude mcp add-json gemini-image '{"command":"npx","args":["gemini-diagram-mcp"],"env":{"GOOGLE_API_KEY":"your-api-key"}}'
```

Or manually edit `~/.claude.json`:
```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "npx",
      "args": ["gemini-diagram-mcp"],
      "env": {
        "GOOGLE_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Cursor

Add to Cursor settings (`Preferences > MCP Servers`):
```json
{
  "gemini-image": {
    "command": "npx",
    "args": ["gemini-diagram-mcp"],
    "env": {
      "GOOGLE_API_KEY": "your-api-key"
    }
  }
}
```

#### Windsurf

Add to `~/.windsurf/mcp.json`:
```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "npx",
      "args": ["gemini-diagram-mcp"],
      "env": {
        "GOOGLE_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Claude Desktop

Add to `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "npx",
      "args": ["gemini-diagram-mcp"],
      "env": {
        "GOOGLE_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Cline (VS Code)

Add to Cline MCP settings in VS Code:
```json
{
  "gemini-image": {
    "command": "npx",
    "args": ["gemini-diagram-mcp"],
    "env": {
      "GOOGLE_API_KEY": "your-api-key"
    }
  }
}
```

### 3. Restart Your Client

Restart the application to load the MCP server.

### Alternative: Global Install

```bash
npm install -g gemini-diagram-mcp
```

Then use `"command": "gemini-diagram-mcp"` instead of npx.

### Alternative: From Source

```bash
git clone https://github.com/arunsanna/gemini-diagram-mcp.git
cd gemini-diagram-mcp
npm install && npm run build
```

Then use:
```json
{
  "gemini-image": {
    "command": "node",
    "args": ["/path/to/gemini-diagram-mcp/dist/index.js"],
    "env": {
      "GOOGLE_API_KEY": "your-api-key"
    }
  }
}
```

## Usage Examples

```
User: "Create an architecture diagram showing React → API Gateway → Lambda → DynamoDB"
AI: → Generated architecture (4:3, 2K): ./react_api_gateway.png

User: "Make the arrows thicker"
AI: → Refined image: ./react_api_gateway_refined.png

User: "Compare latency: 450ms before vs 120ms after optimization"
AI: → Generated comparison (16:9, 2K): ./latency_comparison.png

User: "Create a nice visual for my presentation"
AI: "I'm not certain about the best visualization type. What type would you prefer?
     - chart: Data visualization with clear labels
     - comparison: Side-by-side panels
     - flow: Sequential stages with arrows
     - architecture: System components with connections
     ..."
```

### Smart Detection

The server auto-detects optimal settings from your prompt:

| Keyword | Detected Type | Aspect Ratio |
|---------|---------------|--------------|
| "compare", "vs", "before/after" | comparison | 16:9 |
| "flow", "process", "pipeline" | flow | 16:9 |
| "architecture", "system", "layers" | architecture | 4:3 |
| "timeline", "roadmap", "phases" | timeline | 16:9 |
| "hierarchy", "org chart", "tree" | hierarchy | 4:3 |
| "matrix", "grid", "quadrant" | matrix | 1:1 |
| "presentation", "slide" | (any) | 4K |
| "square" | (any) | 1:1 |
| "wide", "banner" | (any) | 2:1 |

## Architecture

```
src/
├── index.ts              # MCP server entry point
├── gemini/
│   ├── index.ts          # Module exports
│   └── client.ts         # Gemini API client with smart detection
└── utils/
    └── session.ts        # Session persistence for refinement
```

### How It Works

1. **Smart Analysis**: `analyzePrompt()` scores prompt against type keywords, returns confidence level
2. **Clarifying Questions**: Low confidence → returns question instead of generating
3. **Prompt Enhancement**: Wraps prompt with professional styling instructions
4. **Image Generation**: Uses `gemini-3-pro-image-preview` via `@google/genai` SDK
5. **Retry Logic**: 3 attempts with exponential backoff (1s → 2s → 4s)
6. **PNG Validation**: Verifies magic bytes before saving
7. **Session Tracking**: Stores last generation in `~/.gemini-diagram-mcp/session.json`

## Development

```bash
git clone https://github.com/arunsanna/gemini-diagram-mcp.git
cd gemini-diagram-mcp
npm install      # Install dependencies
npm run build    # Build TypeScript
npm run dev      # Watch mode
```

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/arunsanna/gemini-diagram-mcp).

## License

MIT
