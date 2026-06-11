import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import type { SciraConfig } from "../types/index.js";
import { saveGlobalMcpConfig } from "../config/load-config.js";

type McpServer = SciraConfig["mcp"]["servers"][number];

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createVerifier(): string {
  return toBase64Url(randomBytes(48));
}

function createChallenge(verifier: string): string {
  return toBase64Url(createHash("sha256").update(verifier).digest());
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, redirect: "error" });
    if (!res.ok) return null;
    return JSON.parse(await res.text()) as T;
  } catch {
    return null;
  }
}

type OAuthEndpoints = {
  authorizationUrl: string;
  tokenUrl: string;
  registrationUrl: string | null;
  suggestedScope: string | null;
};

type AsMetadata = {
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
};

async function tryDiscoverFromIssuer(issuer: string): Promise<OAuthEndpoints | null> {
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    const meta = await fetchJson<AsMetadata>(issuer.replace(/\/+$/, "") + path);
    if (meta?.authorization_endpoint && meta?.token_endpoint) {
      return {
        authorizationUrl: meta.authorization_endpoint,
        tokenUrl: meta.token_endpoint,
        registrationUrl: meta.registration_endpoint ?? null,
        suggestedScope: meta.scopes_supported?.join(" ") ?? null,
      };
    }
  }
  return null;
}

function parseBearerResourceMetadata(wwwAuthenticate: string | null): { resourceMetadataUrl: string | null; scope: string | null } {
  if (!wwwAuthenticate) return { resourceMetadataUrl: null, scope: null };
  const bearerMatch = wwwAuthenticate.match(/Bearer\s+(.+)/i);
  if (!bearerMatch?.[1]) return { resourceMetadataUrl: null, scope: null };
  const params: Record<string, string> = {};
  const pairs = bearerMatch[1].match(/([a-zA-Z_]+)\s*=\s*("[^"]*"|[^,\s]+)/g) ?? [];
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    const key = pair.slice(0, eqIdx).trim().toLowerCase();
    const val = pair.slice(eqIdx + 1).trim().replace(/^"|"$/g, "");
    params[key] = val;
  }
  return { resourceMetadataUrl: params["resource_metadata"] ?? null, scope: params["scope"] ?? null };
}

async function probeServerChallenge(url: string): Promise<{ resourceMetadataUrl: string | null; scope: string | null }> {
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, redirect: "error" }).catch(() => null);
    return parseBearerResourceMetadata(res?.headers.get("www-authenticate") ?? null);
  } catch {
    return { resourceMetadataUrl: null, scope: null };
  }
}

async function tryResourceMetadata(url: string): Promise<string | null> {
  const rm = await fetchJson<{ authorization_servers?: string[] }>(url);
  return rm?.authorization_servers?.[0] ?? null;
}

export async function discoverOAuthEndpoints(srv: McpServer): Promise<OAuthEndpoints> {
  if (srv.oauthAuthorizationUrl && srv.oauthTokenUrl) {
    return { authorizationUrl: srv.oauthAuthorizationUrl, tokenUrl: srv.oauthTokenUrl, registrationUrl: null, suggestedScope: null };
  }

  const issuer = srv.oauthIssuerUrl ?? null;
  if (issuer) {
    const found = await tryDiscoverFromIssuer(issuer);
    if (found) return found;
  }

  if (srv.url) {
    const parsed = new URL(srv.url);
    const origin = parsed.origin;
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");

    // Step 1: probe the MCP server URL for WWW-Authenticate: Bearer resource_metadata=...
    const challenge = await probeServerChallenge(srv.url);
    const rmCandidates: string[] = [
      ...(challenge.resourceMetadataUrl ? [challenge.resourceMetadataUrl] : []),
      ...(path ? [`${origin}/.well-known/oauth-protected-resource${path}`] : []),
      `${origin}/.well-known/oauth-protected-resource`,
    ];

    for (const rmUrl of rmCandidates) {
      const asIssuer = await tryResourceMetadata(rmUrl);
      if (asIssuer) {
        const found = await tryDiscoverFromIssuer(asIssuer);
        if (found) return { ...found, suggestedScope: found.suggestedScope ?? challenge.scope };
      }
    }

    // Step 2: try AS discovery directly on origin
    const fromOrigin = await tryDiscoverFromIssuer(origin);
    if (fromOrigin) return fromOrigin;
  }

  throw new Error(
    `Could not discover OAuth endpoints for "${srv.name}". ` +
    "Provide --oauth-issuer <url> or --oauth-auth-url + --oauth-token-url when adding."
  );
}

async function registerDynamicClient(registrationUrl: string, redirectUri: string): Promise<{ clientId: string; clientSecret?: string }> {
  const res = await fetch(registrationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Scira CLI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error("Dynamic client registration failed — provide --oauth-client-id manually");
  const data = JSON.parse(await res.text()) as { client_id?: string; client_secret?: string };
  if (!data.client_id) throw new Error("Dynamic registration did not return client_id — provide --oauth-client-id manually");
  return { clientId: data.client_id, clientSecret: data.client_secret };
}

function patchClientId(mcp: SciraConfig["mcp"], name: string, clientId: string, clientSecret?: string): SciraConfig["mcp"] {
  return {
    ...mcp,
    servers: mcp.servers.map((s) =>
      s.name === name ? { ...s, oauthClientId: clientId, ...(clientSecret ? { oauthClientSecret: clientSecret } : {}) } : s
    ),
  };
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? `open "${url}"` :
    process.platform === "win32"  ? `start "" "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function waitForCallback(port: number, timeoutMs = 120_000): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://localhost:${port}`);
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>OAuth connected — you can close this tab.</h2></body></html>");
      server.close();
      if (code && state) resolve({ code, state });
      else reject(new Error("OAuth callback missing code or state"));
    });
    server.listen(port, "127.0.0.1");
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("OAuth flow timed out (2 min). Run `scira mcp oauth <name>` to retry."));
    }, timeoutMs);
    server.once("close", () => clearTimeout(timer));
  });
}

async function exchangeCode(opts: {
  tokenUrl: string;
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.verifier,
  });
  if (opts.clientSecret) body.set("client_secret", opts.clientSecret);

  const res = await fetch(opts.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = JSON.parse(await res.text()) as {
    access_token?: string; refresh_token?: string; expires_in?: number;
    error?: string; error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Token exchange failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

async function refreshToken(opts: {
  tokenUrl: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });
  if (opts.clientSecret) body.set("client_secret", opts.clientSecret);

  const res = await fetch(opts.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = JSON.parse(await res.text()) as {
    access_token?: string; refresh_token?: string; expires_in?: number;
    error?: string; error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Token refresh failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? opts.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

function patchTokens(
  mcp: SciraConfig["mcp"],
  name: string,
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: number }
): SciraConfig["mcp"] {
  return {
    ...mcp,
    servers: mcp.servers.map((s) =>
      s.name === name
        ? { ...s, oauthAccessToken: tokens.accessToken, oauthRefreshToken: tokens.refreshToken, oauthTokenExpiresAt: tokens.expiresAt }
        : s
    ),
  };
}

export async function runOAuthFlow(
  srv: McpServer,
  config: SciraConfig
): Promise<void> {
  const port = 49152 + Math.floor(Math.random() * 16383);
  const redirectUri = `http://localhost:${port}/callback`;

  const endpoints = await discoverOAuthEndpoints(srv);
  const { authorizationUrl, tokenUrl } = endpoints;
  let clientId = srv.oauthClientId;
  let clientSecret = srv.oauthClientSecret;
  let updatedConfig = config;

  if (!clientId) {
    if (!endpoints.registrationUrl) {
      throw new Error(
        `"${srv.name}" does not support dynamic client registration. ` +
        "Re-add with --oauth-client-id <id> (see the provider's app/developer settings)."
      );
    }
    process.stdout.write(`Registering Scira CLI with ${srv.name} OAuth server…\n`);
    const reg = await registerDynamicClient(endpoints.registrationUrl, redirectUri);
    clientId = reg.clientId;
    clientSecret = reg.clientSecret ?? clientSecret;
    const patchedMcp = patchClientId(config.mcp, srv.name, clientId, clientSecret);
    await saveGlobalMcpConfig(patchedMcp);
    updatedConfig = { ...config, mcp: patchedMcp };
    process.stdout.write(`Registered client_id: ${clientId}\n`);
  }

  const verifier = createVerifier();
  const challenge = createChallenge(verifier);
  const state = toBase64Url(randomBytes(16));
  const scope = srv.oauthScopes ?? endpoints.suggestedScope ?? undefined;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  if (scope) params.set("scope", scope);

  const fullUrl = `${authorizationUrl}?${params}`;
  process.stdout.write(`\nOpening browser for OAuth…\nIf it didn't open, paste this URL:\n${fullUrl}\n\nWaiting for callback on ${redirectUri} …\n`);
  openBrowser(fullUrl);

  const { code, state: returnedState } = await waitForCallback(port);
  if (returnedState !== state) throw new Error("OAuth state mismatch — possible CSRF");

  const tokens = await exchangeCode({ tokenUrl, code, verifier, redirectUri, clientId, clientSecret });
  await saveGlobalMcpConfig(patchTokens(updatedConfig.mcp, srv.name, tokens));
  process.stdout.write(`\nOAuth connected for "${srv.name}". Token saved to ~/.scira/config.json.\n`);
}

export async function resolveOAuthToken(
  srv: McpServer,
  config: SciraConfig
): Promise<string> {
  if (srv.oauthAccessToken && (!srv.oauthTokenExpiresAt || srv.oauthTokenExpiresAt - Date.now() > 60_000)) {
    return srv.oauthAccessToken;
  }

  if (srv.oauthRefreshToken && srv.oauthClientId) {
    const { tokenUrl } = await discoverOAuthEndpoints(srv);
    const tokens = await refreshToken({
      tokenUrl,
      refreshToken: srv.oauthRefreshToken,
      clientId: srv.oauthClientId,
      clientSecret: srv.oauthClientSecret,
    });
    await saveGlobalMcpConfig(patchTokens(config.mcp, srv.name, tokens));
    return tokens.accessToken;
  }

  throw new Error(`OAuth session expired for "${srv.name}". Run: scira mcp oauth ${srv.name}`);
}
