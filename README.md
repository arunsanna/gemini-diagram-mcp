# gemini-diagram-mcp

[![npm version](https://badge.fury.io/js/gemini-diagram-mcp.svg)](https://www.npmjs.com/package/gemini-diagram-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for generating diagrams, charts, and visualizations using Gemini image generation on Vertex AI.

## Features

- **Smart Detection**: Auto-detects diagram type from prompt, asks clarifying questions when uncertain
- **Universal**: Works with Claude Code, Claude Desktop, Cursor, Windsurf, Cline, and any MCP client
- **Professional Styling**: Consistent SaaS aesthetic with proper typography and color palette
- **Configurable**: Aspect ratios (16:9, 1:1, 4:3, etc.) and resolutions (1K, 2K, 4K)
- **Robust**: Retry logic with exponential backoff, generated image validation
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

Get a Vertex AI API key for the Vertex AI Express Mode flow. The server enforces `vertexai: true` and defaults to `gemini-3-pro-image-preview` (Nano Banana Pro class).

### 2. Choose How You Run It

You can run this MCP in two ways:

1. **Local stdio server (classic MCP)**: each client spawns `npx gemini-diagram-mcp` and you provide the Vertex AI API key to the client.
2. **Centralized HTTP server (recommended for teams)**: run one Docker container with the API key + auth (static token or OIDC), and have clients connect via a local proxy (no API key on clients).

## Centralized Deployment (Docker)

This runs one MCP server that all agents share.

### Requirements

- `VERTEX_AI_API_KEY` (preferred)
- `GOOGLE_API_KEY` or `GOOGLE_CLOUD_API_KEY` (backward-compatible aliases)
- `GOOGLE_GENAI_USE_VERTEXAI=true` is enforced by the server
- `VERTEX_AI_IMAGE_MODEL=gemini-3-pro-image-preview` by default
- Auth (choose one):
  - **Static token** (default): `MCP_AUTH_MODE=token` + `MCP_AUTH_TOKEN` (or `MCP_AUTH_TOKENS`)
  - **OIDC JWT** (recommended for multi-user): `MCP_AUTH_MODE=oidc` + `OIDC_ISSUER` (+ `OIDC_AUDIENCE` recommended)
  - **No auth** (not recommended): `MCP_AUTH_MODE=none` (only safe behind a trusted auth proxy / private network)

### Suggested `.env`

```bash
VERTEX_AI_API_KEY=your-vertex-ai-api-key
# GOOGLE_GENAI_USE_VERTEXAI=true
# VERTEX_AI_IMAGE_MODEL=gemini-3-pro-image-preview
# PUBLIC_BASE_URL=http://<server-ip>:3000

# Auth (choose one)
MCP_AUTH_MODE=token
MCP_AUTH_TOKEN=your-strong-token

# Or: OIDC JWT auth (per-user tokens)
# MCP_AUTH_MODE=oidc
# OIDC_ISSUER=https://issuer.example.com/realms/your-realm
# OIDC_AUDIENCE=your-audience
# OIDC_JWKS_URI=https://issuer.example.com/.../jwks.json
```

### Run

```bash
export VERTEX_AI_API_KEY="your-vertex-ai-api-key"
export MCP_AUTH_MODE="token"
export MCP_AUTH_TOKEN="your-strong-token"
docker compose up --build
```

Outputs are written to `./data/out` on the host (via bind mount).

The MCP endpoint will be:

- Streamable HTTP: `http://localhost:3000/mcp`
- Legacy SSE: `http://localhost:3000/sse`

All endpoints require auth. Depending on your auth mode:

**Static token mode** (`MCP_AUTH_MODE=token`):
- `Authorization: Bearer $MCP_AUTH_TOKEN` (recommended), or
- `?token=$MCP_AUTH_TOKEN` (useful for clients that can't set headers)

**OIDC JWT mode** (`MCP_AUTH_MODE=oidc`):
- `Authorization: Bearer <OIDC access token>`
- `?token=...` is disabled by default in oidc mode; set `MCP_ALLOW_QUERY_TOKEN=1` to allow it (not recommended)

## Client Setup (Local Proxy)

For MCP clients that expect `command`/`args` (Claude Code, Claude Desktop, VS Code integrations, etc.), run the included stdio proxy so the client talks stdio but execution happens on the central server.

Set environment:

- `MCP_REMOTE_URL` (default: `http://localhost:3000/mcp`)
- `MCP_BEARER_TOKEN` (required; OIDC access token or static token)

Example (Claude Code):

```bash
claude mcp add-json gemini-image '{
  "command":"npx",
  "args":["gemini-diagram-mcp","proxy"],
  "env":{
    "MCP_REMOTE_URL":"http://localhost:3000/mcp",
    "MCP_BEARER_TOKEN":"your-bearer-token"
  }
}'
```

Example (Claude Desktop):

Add to `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "npx",
      "args": ["gemini-diagram-mcp", "proxy"],
      "env": {
        "MCP_REMOTE_URL": "http://localhost:3000/mcp",
        "MCP_BEARER_TOKEN": "your-bearer-token"
      }
    }
  }
}
```

Example (VS Code / Cline):

```json
{
  "gemini-image": {
    "command": "npx",
    "args": ["gemini-diagram-mcp", "proxy"],
    "env": {
      "MCP_REMOTE_URL": "http://localhost:3000/mcp",
      "MCP_BEARER_TOKEN": "your-bearer-token"
    }
  }
}
```

Other MCP clients (Codex CLI, opencode, etc.):

If your client supports configuring an MCP server with `command` + `args` + `env`, use the same proxy config:

- `command`: `npx`
- `args`: `["gemini-diagram-mcp","proxy"]`
- `env`: `MCP_REMOTE_URL`, `MCP_BEARER_TOKEN`

## Local (Classic) Installation

No build required - just use `npx`:

#### Claude Code

```bash
claude mcp add-json gemini-image '{"command":"npx","args":["gemini-diagram-mcp"],"env":{"VERTEX_AI_API_KEY":"your-vertex-ai-api-key"}}'
```

Or manually edit `~/.claude.json`:
```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "npx",
      "args": ["gemini-diagram-mcp"],
      "env": {
        "VERTEX_AI_API_KEY": "your-vertex-ai-api-key"
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
      "VERTEX_AI_API_KEY": "your-vertex-ai-api-key"
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
        "VERTEX_AI_API_KEY": "your-vertex-ai-api-key"
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
        "VERTEX_AI_API_KEY": "your-vertex-ai-api-key"
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
      "VERTEX_AI_API_KEY": "your-vertex-ai-api-key"
    }
  }
}
```

### 3. Restart Your Client

Restart the application to load the MCP server.

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
├── index.ts              # CLI entry point (stdio/http/proxy)
├── http.ts               # Centralized HTTP MCP server
├── proxy.ts              # Stdio proxy that forwards to HTTP server
├── stdio.ts              # Classic stdio MCP server
├── mcp.ts                # Tool registration shared across modes
├── gemini/
│   ├── index.ts          # Module exports
│   └── client.ts         # Gemini API client with smart detection
```

### How It Works

1. **Smart Analysis**: `analyzePrompt()` scores prompt against type keywords, returns confidence level
2. **Clarifying Questions**: Low confidence → returns question instead of generating
3. **Prompt Enhancement**: Wraps prompt with professional styling instructions
4. **Image Generation**: Uses Vertex AI mode with `gemini-3-pro-image-preview` via `@google/genai`
5. **Retry Logic**: 3 attempts with exponential backoff (1s → 2s → 4s)
6. **Image Validation**: Verifies generated image bytes and saves with the correct file extension
7. **Session Tracking**: In-memory per MCP connection/session (suitable for centralized servers)

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/arunsanna/gemini-diagram-mcp).

## License

MIT
