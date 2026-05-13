# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-13

### Added
- `prepare_image` tool — returns supported parameters, prompt recommendations, and polished prompts before generating
- `style` parameter on `generate_image` and `refine_image` — `professional` (default) or `creative` mode
- `watermark` parameter — configurable watermark text (defaults to `arunsanna.com`)
- `user_approval` parameter — architecture context authorization flag
- Comic/visual story pattern with stock character (Alex) and consistency rules
- CLI one-shot generate mode: `npx gemini-diagram-mcp generate "prompt" [-o file] [-t type] [--size 2K] [--style professional]`
- Visual vocabulary injection for architecture/flow diagrams (cylinders, pipes, diamonds, cloud silhouettes)
- Component-specific shape hints for 40+ technologies (PostgreSQL, Kafka, Kubernetes, AWS, etc.)
- Dimension mismatch warnings (aspect ratio and resolution validation)
- Multi-panel comic story guidance in `prepare_image`

### Changed
- Migrated from Gemini API to Vertex AI API-key mode (`vertexai: true`)
- Default model updated to `gemini-3-pro-image-preview` (Nano Banana Pro)
- Updated `@google/genai` to `^1.52.0`
- Updated `@modelcontextprotocol/sdk` to `^1.29.0` (fixes ReDoS + data leak CVEs)
- Updated `jose` to `^6.2.3`
- Keyword hints (`square`, `wide`, `presentation`, etc.) no longer override explicit `aspect_ratio` or `size` parameters
- Images are kept on dimension mismatch instead of being rejected (warning only)
- `refine_image` preserves `style` and `watermark` from the original session

### Fixed
- Security: ReDoS vulnerability in `@modelcontextprotocol/sdk` (GHSA-8r9q-7v3j-jr4g)
- Security: Cross-client data leak in `@modelcontextprotocol/sdk` (GHSA-345p-7cg4-v4c7)
- Security: Authorization bypass in `@hono/node-server` (transitive dependency)

### Removed
- `2:1` aspect ratio (was listed in docs but not supported by schema); use `21:9` instead

## [1.0.7] - 2026-03-14

### Changed
- Deploy: update forge image tag and deployment configs

## [1.0.6] - 2026-03-07

### Added
- OIDC JWT authentication mode for multi-user deployments
- Session timeout and max session limits for HTTP server
- `MCP_AUTH_TOKENS` for multiple static tokens

### Changed
- HTTP server uses Streamable HTTP transport (MCP spec compliance)
- Legacy SSE transport still available for older clients

## [1.0.0] - 2026-02-05

### Added
- Initial release
- `generate_image` and `refine_image` tools
- Smart diagram type detection from natural language
- Auto aspect ratio and resolution selection
- Professional styling with SaaS aesthetic
- Retry logic with exponential backoff
- Centralized HTTP server with Docker support
- Stdio proxy for remote server connections
- Static token authentication
