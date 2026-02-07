import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type McpAuthMode = "token" | "oidc" | "none";

export type AuthResult =
  | { ok: true; claims?: JWTPayload }
  | { ok: false; status: number; error: string };

function parseCommaList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseAuthMode(raw: string | undefined): McpAuthMode {
  const v = (raw ?? "token").trim().toLowerCase();
  if (v === "token" || v === "static" || v === "bearer-token") return "token";
  if (v === "oidc" || v === "jwt" || v === "oidc-jwt") return "oidc";
  if (v === "none" || v === "off" || v === "disabled") return "none";
  return "token";
}

export function extractBearerToken(
  req: any,
  opts?: { allowQueryToken?: boolean }
): string | undefined {
  const auth = req?.headers?.authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1];
  }

  if (opts?.allowQueryToken) {
    const q = req?.query?.token;
    if (typeof q === "string" && q.length > 0) return q;
  }

  return undefined;
}

export function createTokenAuthVerifierFromEnv(): {
  mode: "token";
  allowQueryToken: boolean;
  verifyRequest: (req: any) => Promise<AuthResult>;
} {
  const allowQueryToken = process.env.MCP_ALLOW_QUERY_TOKEN !== "0";
  const tokens = parseCommaList(process.env.MCP_AUTH_TOKENS).length
    ? parseCommaList(process.env.MCP_AUTH_TOKENS)
    : parseCommaList(process.env.MCP_AUTH_TOKEN);

  if (tokens.length === 0) {
    throw new Error(
      "Missing required auth configuration: set MCP_AUTH_TOKEN (or MCP_AUTH_TOKENS) when MCP_AUTH_MODE=token"
    );
  }

  return {
    mode: "token",
    allowQueryToken,
    async verifyRequest(req: any): Promise<AuthResult> {
      const token = extractBearerToken(req, { allowQueryToken });
      if (!token) return { ok: false, status: 401, error: "Unauthorized" };
      if (!tokens.includes(token)) {
        return { ok: false, status: 401, error: "Unauthorized" };
      }
      return { ok: true };
    },
  };
}

async function discoverJwksUri(issuer: string): Promise<string> {
  const normalizedIssuer = issuer.replace(/\/+$/, "");
  const wellKnownUrl = `${normalizedIssuer}/.well-known/openid-configuration`;
  const res = await fetch(wellKnownUrl, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed OIDC discovery (${res.status}): ${wellKnownUrl}`
    );
  }
  const json = (await res.json()) as { jwks_uri?: string };
  if (!json.jwks_uri) {
    throw new Error(`OIDC discovery missing jwks_uri: ${wellKnownUrl}`);
  }
  return json.jwks_uri;
}

export async function createOidcAuthVerifierFromEnv(): Promise<{
  mode: "oidc";
  allowQueryToken: boolean;
  verifyRequest: (req: any) => Promise<AuthResult>;
}> {
  const allowQueryToken = process.env.MCP_ALLOW_QUERY_TOKEN === "1";

  const issuer = process.env.OIDC_ISSUER?.trim();
  if (!issuer) {
    throw new Error(
      "Missing required auth configuration: set OIDC_ISSUER when MCP_AUTH_MODE=oidc"
    );
  }

  const audience = parseCommaList(process.env.OIDC_AUDIENCE);
  if (audience.length === 0) {
    // Not always required, but strongly recommended. Leave this as a startup warning
    // rather than a hard error to reduce deployment friction.
    console.error(
      "Warning: OIDC_AUDIENCE is not set. Tokens will be validated without an audience check."
    );
  }

  const jwksUri =
    process.env.OIDC_JWKS_URI?.trim() || (await discoverJwksUri(issuer));

  const jwks = createRemoteJWKSet(new URL(jwksUri));

  return {
    mode: "oidc",
    allowQueryToken,
    async verifyRequest(req: any): Promise<AuthResult> {
      const token = extractBearerToken(req, { allowQueryToken });
      if (!token) return { ok: false, status: 401, error: "Unauthorized" };

      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          audience: audience.length > 0 ? audience : undefined,
        });
        return { ok: true, claims: payload };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 401, error: `Unauthorized: ${msg}` };
      }
    },
  };
}

export function createNoAuthVerifierFromEnv(): {
  mode: "none";
  allowQueryToken: boolean;
  verifyRequest: (_req: any) => Promise<AuthResult>;
} {
  console.error(
    "Warning: MCP_AUTH_MODE=none disables authentication. Only use behind a trusted auth proxy / private network."
  );
  return {
    mode: "none",
    allowQueryToken: false,
    async verifyRequest(): Promise<AuthResult> {
      return { ok: true };
    },
  };
}

