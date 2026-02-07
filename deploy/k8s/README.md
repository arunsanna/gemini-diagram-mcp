# Kubernetes Deployment

This project can run as a centralized MCP server over Streamable HTTP at `/mcp`.

## Recommended Multi-User Auth: OIDC JWT

Run the MCP server with `MCP_AUTH_MODE=oidc`. Each user configures their MCP client to send:

`Authorization: Bearer <OIDC access token>`

The server validates the JWT signature via OIDC JWKS and checks `iss` (and `aud` if configured).

## Build And Push An Image

The repo includes a multi-stage `Dockerfile` that builds `dist/`.

```bash
docker build -t <registry>/gemini-diagram-mcp:<tag> .
docker push <registry>/gemini-diagram-mcp:<tag>
```

## Manifests

- `deploy/k8s/base`: Deployment + Service (static token auth by default).
- `deploy/k8s/overlays/oidc`: Patches base to use OIDC JWT auth + adds an example Ingress.

### 1) Create Secrets

Create a secret with a Gemini API key (pick one key name):

```bash
kubectl apply -f deploy/k8s/base/secret.example.yaml
```

### 2) Deploy (OIDC)

Edit `deploy/k8s/overlays/oidc/patch-deployment.yaml`:
- `image:` (your registry tag)
- `OIDC_ISSUER`
- `OIDC_AUDIENCE` (recommended)
- `PUBLIC_BASE_URL` (recommended)

Then apply:

```bash
kubectl apply -k deploy/k8s/overlays/oidc
```

## Client Configuration (Examples)

Codex:
```bash
codex mcp add gemini-image --url https://gemini-mcp.example.com/mcp --bearer-token-env-var GEMINI_MCP_TOKEN
```

Claude Code:
```bash
claude mcp add --transport http gemini-image https://gemini-mcp.example.com/mcp --header "Authorization: Bearer $GEMINI_MCP_TOKEN"
```

opencode (`~/.config/opencode/opencode.json`):
```json
{
  "mcp": {
    "gemini-image": {
      "type": "remote",
      "url": "https://gemini-mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <OIDC_ACCESS_TOKEN>"
      },
      "enabled": true
    }
  }
}
```
