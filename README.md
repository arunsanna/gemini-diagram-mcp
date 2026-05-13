# gemini-diagram-mcp

[![npm version](https://badge.fury.io/js/gemini-diagram-mcp.svg)](https://www.npmjs.com/package/gemini-diagram-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for generating diagrams, charts, and visualizations using Gemini image generation on Vertex AI.

## Features

- **Smart Detection**: Auto-detects diagram type from prompt, asks clarifying questions when uncertain
- **Universal**: Works with Claude Code, Claude Desktop, Cursor, Windsurf, Cline, and any MCP client
- **Two Style Modes**: `professional` (clean SaaS aesthetic) and `creative` (vintage, comic, dark theme, etc.)
- **Configurable**: Aspect ratios (16:9, 1:1, 4:3, 9:16, 21:9, and more) and resolutions (1K, 2K, 4K)
- **Custom Watermark**: Configurable watermark text rendered on every image
- **Iterative Refinement**: Refine the last generated image without repeating the full prompt
- **Pre-generation Guidance**: `prepare_image` tool returns prompt recommendations before you generate
- **Comic/Story Pattern**: Built-in stock character (Alex) and comic art style for multi-panel storytelling
- **Robust**: Retry logic with exponential backoff, generated image validation, dimension mismatch warnings
- **Three Deployment Modes**: Local stdio, centralized HTTP server, or stdio proxy to remote server
- **Auth**: Static bearer token, OIDC JWT, or no-auth (behind trusted proxy)

## Tools

| Tool | Description |
|------|-------------|
| `generate_image` | Generate a diagram/chart/visualization from natural language |
| `refine_image` | Iteratively refine the last generated image |
| `prepare_image` | Get guidance, supported parameters, and a polished prompt before generating |

### Parameters

**generate_image**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | required | Natural language description of the image |
| `output` | string | auto | Output filename (auto-generated from prompt if omitted) |
| `type` | enum | `auto` | `auto`, `chart`, `comparison`, `flow`, `architecture`, `timeline`, `hierarchy`, `matrix`, `hero`, `visualization` |
| `aspect_ratio` | enum | auto | `16:9`, `1:1`, `4:3`, `3:4`, `9:16`, `3:2`, `2:3`, `21:9` (auto-selected by type if omitted) |
| `size` | enum | `2K` | `1K` (~1024px), `2K` (~2048px), `4K` (~4096px) |
| `style` | enum | `professional` | `professional` (clean SaaS aesthetic) or `creative` (your prompt drives the look) |
| `watermark` | string | `arunsanna.com` | Watermark text in the bottom-right corner |
| `user_approval` | boolean | `false` | Set `true` when the requester explicitly approves using supplied architecture details for diagramming |

**refine_image**
| Parameter | Type | Description |
|-----------|------|-------------|
| `refinement` | string | Description of changes to apply to the last generated image |

**prepare_image**
| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | Optional draft prompt to analyze and polish |
| `type` | string | Optional type hint to get specific guidance |

## Installation

### 1. Get API Key

Get a Vertex AI API key for the Vertex AI Express Mode flow. The server enforces `vertexai: true` and defaults to `gemini-3-pro-image-preview` (Nano Banana Pro).

### 2. Choose How You Run It

You can run this MCP in three ways:

1. **Local stdio server (classic MCP)**: each client spawns `npx gemini-diagram-mcp` and you provide the Vertex AI API key to the client.
2. **Centralized HTTP server (recommended for teams)**: run one Docker container with the API key + auth (static token or OIDC), and have clients connect via a local proxy (no API key on clients).
3. **CLI one-shot**: `npx gemini-diagram-mcp generate "your prompt"` to generate directly from the command line.

## Centralized Deployment (Docker)

This runs one MCP server that all agents share.

### Requirements

- `VERTEX_AI_API_KEY` (preferred) or `GOOGLE_API_KEY` / `GOOGLE_CLOUD_API_KEY`
- `GOOGLE_GENAI_USE_VERTEXAI=true` is enforced by the server
- `VERTEX_AI_IMAGE_MODEL=gemini-3-pro-image-preview` by default (see [Supported Models](#supported-models))
- Auth (choose one):
  - **Static token** (default): `MCP_AUTH_MODE=token` + `MCP_AUTH_TOKEN` (or `MCP_AUTH_TOKENS`)
  - **OIDC JWT** (recommended for multi-user): `MCP_AUTH_MODE=oidc` + `OIDC_ISSUER` (+ `OIDC_AUDIENCE` recommended)
  - **No auth** (not recommended): `MCP_AUTH_MODE=none` (only safe behind a trusted auth proxy / private network)

### Suggested `.env`

```bash
VERTEX_AI_API_KEY=your-vertex-ai-api-key

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
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

No build required — just use `npx`:

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

## CLI Usage

Generate images directly from the command line:

```bash
export VERTEX_AI_API_KEY="your-key"
npx gemini-diagram-mcp generate "Architecture: React → API Gateway → Lambda → DynamoDB"
npx gemini-diagram-mcp generate "Sales funnel chart" -t chart --size 4K --style creative
npx gemini-diagram-mcp generate "Vintage poster for a coffee shop" --style creative -o poster.png
```

## Usage Examples

```
User: "Create an architecture diagram showing React → API Gateway → Lambda → DynamoDB"
AI: → Generated architecture (4:3, 2K, style: professional): ./react_api_gateway.png

User: "Make the arrows thicker and add a Redis cache layer"
AI: → Refined image: ./react_api_gateway_refined.png

User: "Compare latency: 450ms before vs 120ms after optimization"
AI: → Generated comparison (16:9, 2K): ./latency_comparison.png

User: "A vintage travel poster for Tokyo, art deco style"
AI: → Tip: set style: "creative" to remove professional constraints
AI: → Generated hero (16:9, 2K, style: creative): ./vintage_tokyo.png

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
| "presentation", "slide", "4k" | (any) | 4K resolution |
| "square" | (any) | 1:1 |
| "wide", "banner", "header" | (any) | 16:9 |
| "portrait", "mobile", "story" | (any) | 9:16 |

### Style Modes

| Mode | Description |
|------|-------------|
| `professional` (default) | White background, SaaS color palette, sans-serif fonts, clean enterprise look |
| `creative` | No aesthetic constraints — your prompt controls colors, fonts, backgrounds, and artistic effects |

Keywords like "vintage", "comic", "dark theme", "watercolor", "retro", "sketch" automatically trigger a tip to switch to `creative` mode.

## Supported Models

| Model ID | Codename | Tier | Best For |
|----------|----------|------|----------|
| `gemini-3-pro-image-preview` | Nano Banana Pro | Pro (default) | Complex diagrams, high-fidelity text rendering, professional assets. Uses reasoning ("Thinking"). |
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | Flash | Speed, high-volume, low-latency use cases. Supports 0.5K–4K resolution. |
| `gemini-2.5-flash-image` | Nano Banana | Flash (legacy) | Cheapest, basic image generation. |

Set via `VERTEX_AI_IMAGE_MODEL` environment variable.

## Architecture

```
src/
├── index.ts              # CLI entry point (stdio / http / proxy / generate)
├── http.ts               # Centralized HTTP MCP server (Streamable HTTP + legacy SSE)
├── proxy.ts              # Stdio proxy that forwards to a remote HTTP MCP server
├── stdio.ts              # Classic stdio MCP server
├── mcp.ts                # MCP tool registration (shared across all modes)
├── auth.ts               # Authentication middleware (token / OIDC JWT / none)
├── runtime.ts            # Environment config, version, model defaults
├── gemini/
│   ├── index.ts          # Module exports
│   └── client.ts         # Gemini API client with smart detection & prompt engineering
```

### How It Works

1. **Smart Analysis**: `analyzePrompt()` scores prompt against type keywords, returns confidence level
2. **Clarifying Questions**: Low confidence → returns question instead of generating
3. **Prompt Enhancement**: Wraps prompt with style instructions (professional or creative) + watermark
4. **Technical Diagrams**: Architecture/flow types get visual vocabulary injection (cylinders for DBs, pipes for queues, etc.)
5. **Image Generation**: Uses Vertex AI mode with `@google/genai` SDK
6. **Retry Logic**: 3 attempts with exponential backoff (1s → 2s → 4s)
7. **Image Validation**: Verifies generated bytes (PNG/JPEG/WebP/GIF), correct extension, dimensions
8. **Session Tracking**: In-memory per MCP connection/session (suitable for centralized servers)

### Deployment Modes

```
┌──────────────┐     stdio      ┌──────────────────┐
│  MCP Client  │◄──────────────►│  stdio server     │  (local, classic)
│ (Claude/etc) │                │  (npx ... )       │
└──────────────┘                └──────────────────┘

┌──────────────┐     stdio      ┌──────────────┐    HTTP     ┌──────────────────┐
│  MCP Client  │◄──────────────►│  stdio proxy │◄──────────►│  HTTP server     │
│ (Claude/etc) │                │  (npx proxy) │            │  (Docker/forge)  │
└──────────────┘                └──────────────┘            └──────────────────┘

┌──────────────┐                                            ┌──────────────────┐
│  CLI         │───────────────────────────────────────────►│  Gemini API      │
│  (generate)  │                                            │  (Vertex AI)     │
└──────────────┘                                            └──────────────────┘
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VERTEX_AI_API_KEY` | — | Vertex AI API key (preferred) |
| `GOOGLE_API_KEY` | — | Backward-compatible alias |
| `GOOGLE_CLOUD_API_KEY` | — | Backward-compatible alias |
| `VERTEX_AI_IMAGE_MODEL` | `gemini-3-pro-image-preview` | Model for image generation |
| `MCP_AUTH_MODE` | `token` | Auth mode: `token`, `oidc`, `none` |
| `MCP_AUTH_TOKEN` | — | Static bearer token(s) |
| `MCP_AUTH_TOKENS` | — | Comma-separated multiple tokens |
| `OIDC_ISSUER` | — | OIDC issuer URL (required for oidc mode) |
| `OIDC_AUDIENCE` | — | Expected token audience(s) |
| `OIDC_JWKS_URI` | — | Override JWKS URI (skips discovery) |
| `MCP_ALLOW_QUERY_TOKEN` | `1` (token mode) | Allow `?token=...` query param auth |
| `MCP_REMOTE_URL` | `http://localhost:3000/mcp` | Proxy remote URL |
| `MCP_BEARER_TOKEN` | — | Proxy auth token |
| `HOST` | `0.0.0.0` | HTTP server bind host |
| `PORT` | `3000` | HTTP server bind port |
| `OUTPUT_DIR` | `./data/out` | Output directory for generated images |
| `PUBLIC_BASE_URL` | `http://localhost:$PORT` | Base URL for download links |
| `INLINE_IMAGES` | `0` | Include base64 image data in tool responses |
| `MCP_SESSION_TIMEOUT_MIN` | `30` | Session timeout in minutes |
| `MCP_MAX_SESSIONS` | `100` | Maximum concurrent sessions |
| `ALLOWED_HOSTS` | — | Comma-separated allowed host headers |

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/arunsanna/gemini-diagram-mcp).

## License

MIT
