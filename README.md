# mcp-gemini-image

MCP server for generating diagrams, charts, and visualizations using Google Gemini's image generation capabilities.

## Project Goals

- **Universal**: Works with Claude Code, Claude Desktop, Cursor, Windsurf, and any MCP-compatible client
- **Simple API**: Natural language prompts → generated images
- **Smart Defaults**: Auto-detect diagram type, generate meaningful filenames
- **Iterative Refinement**: Support `--refine` to modify last generated image

## Features (Planned)

### Core Tools

| Tool | Description |
|------|-------------|
| `generate_image` | Generate diagram/chart/visualization from prompt |
| `refine_image` | Iteratively refine the last generated image |
| `list_types` | List supported diagram types |

### Supported Types (Auto-detected)

- **Diagrams**: Architecture, flow, sequence, ER, class
- **Charts**: Comparison, metrics, bar, pie, timeline
- **Visualizations**: Process flows, workflows, pipelines

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
GEMINI_API_KEY=your-api-key  # Required
```

### Claude Code (~/.claude/settings.json)

```json
{
  "mcpServers": {
    "gemini-image": {
      "command": "mcp-gemini-image",
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}"
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
AI: [calls generate_image tool] → saves architecture_diagram.png

User: "Make the database icon larger"
AI: [calls refine_image tool] → updates the image
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Test locally
node dist/index.js
```

## TODO

- [ ] Implement MCP server with stdio transport
- [ ] Add generate_image tool
- [ ] Add refine_image tool (stateful)
- [ ] Integrate with Gemini API for image generation
- [ ] Add output directory configuration
- [ ] Write tests
- [ ] Publish to npm

## Architecture

```
src/
├── index.ts           # MCP server entry point
├── tools/
│   ├── generate.ts    # generate_image implementation
│   └── refine.ts      # refine_image implementation
├── gemini/
│   └── client.ts      # Gemini API wrapper
└── utils/
    └── filename.ts    # Smart filename generation
```

## Prior Art

This wraps the functionality of `~/bin/gemini-image-gen` into an MCP server for broader compatibility.

## License

MIT
