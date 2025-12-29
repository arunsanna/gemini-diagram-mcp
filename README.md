# mcp-gemini-image

MCP server for generating diagrams, charts, and visualizations using Google Gemini's image generation capabilities.

## Features

- **Universal**: Works with Claude Code, Claude Desktop, Cursor, Windsurf, and any MCP-compatible client
- **Simple API**: Natural language prompts → generated images
- **Smart Defaults**: Auto-detect diagram type, generate meaningful filenames
- **Iterative Refinement**: Modify last generated image without repeating the full prompt
- **Session Persistence**: State preserved across MCP calls (1 hour expiry)

## Tools

| Tool | Description |
|------|-------------|
| `generate_image` | Generate diagram/chart/visualization from natural language |
| `refine_image` | Iteratively refine the last generated image |

### Supported Types (Auto-detected)

- **Diagrams**: Architecture, flow, sequence, ER, class, component, system, UML
- **Charts**: Comparison, metrics, bar, pie, line, statistics, data, trend
- **Visualizations**: Process flows, workflows, pipelines, timelines, roadmaps

## Installation

```bash
# From npm (once published)
npm install -g mcp-gemini-image

# From source
git clone https://github.com/arunsanna/mcp-gemini-image
cd mcp-gemini-image
npm install && npm run build
```

## Configuration

### Environment Variables

```bash
# Either of these works
GEMINI_API_KEY=your-api-key
GOOGLE_API_KEY=your-api-key
```

### Claude Code (~/.claude.json)

```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "node",
      "args": ["/path/to/mcp-gemini-image/dist/index.js"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Desktop (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "npx",
      "args": ["mcp-gemini-image"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Usage Examples

Once configured, the AI can use these tools:

```
User: "Generate an architecture diagram showing React → API → Postgres"
AI: [calls generate_image with prompt] → react_api_postgres.png

User: "Make the database icon larger"
AI: [calls refine_image] → react_api_postgres_refined.png

User: "Create a comparison chart of latency: before 450ms, after 120ms"
AI: [calls generate_image] → latency_comparison.png
```

### Tool Parameters

**generate_image**
- `prompt` (required): Natural language description
- `output` (optional): Output filename (auto-generated if not provided)
- `type` (optional): `diagram` | `chart` | `visualization` | `auto` (default: auto)

**refine_image**
- `refinement` (required): Description of changes to make

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Test locally (requires GEMINI_API_KEY)
node dist/index.js
```

## Architecture

```
src/
├── index.ts              # MCP server entry point
├── gemini/
│   ├── index.ts          # Module exports
│   └── client.ts         # Gemini API wrapper
└── utils/
    ├── index.ts          # Module exports
    └── session.ts        # Session persistence
```

### How It Works

1. **Prompt Enhancement**: Raw prompts are wrapped with professional styling instructions based on detected type
2. **Image Generation**: Uses Gemini's `imagen-3.0-generate-002` model via `@google/genai` SDK
3. **Session Tracking**: Last generation stored in `~/.mcp-gemini-image/session.json` for refinement
4. **Smart Filenames**: Auto-generated from prompt keywords (e.g., "auth flow diagram" → `auth_flow_diagram.png`)

## Prior Art

This provides MCP server functionality inspired by `~/bin/gemini-image-gen` for broader tool compatibility.

## License

MIT
