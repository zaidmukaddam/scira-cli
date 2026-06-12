import { z } from "zod";

export const ApprovalModeSchema = z.enum(["manual", "suggest", "auto"]);

export const ThemeSchema = z.enum(["dark", "light", "auto"]).default("auto");

export const SciraConfigSchema = z.object({
  theme: ThemeSchema,
  llmProvider: z.enum(["gateway", "xai", "workers-ai", "huggingface"]).default("gateway"),
  model: z.string().default("deepseek/deepseek-v4-flash"),
  // last selected model per LLM provider, restored when switching back
  lastModels: z.record(z.string(), z.string()).default({}),
  approvalMode: ApprovalModeSchema.default("suggest"),
  alwaysAllowLinks: z.boolean().default(false),
  runDirectory: z.string().default(".scira/runs"),
  maxSources: z.number().int().min(1).max(100).default(20),
  citationPolicy: z.enum(["strict", "balanced"]).default("strict"),
  search: z.object({
    provider: z.enum(["parallel", "exa", "firecrawl"]).default("exa"),
    maxResults: z.number().int().min(1).max(20).default(8),
    includeDomains: z.array(z.string()).default([]),
    excludeDomains: z.array(z.string()).default([]),
    afterDate: z.string().optional(),
    maxAgeSeconds: z.number().int().positive().optional(),
    maxCharsTotal: z.number().int().positive().optional()
  }).default({
    provider: "exa",
    maxResults: 20,
    includeDomains: [],
    excludeDomains: []
  }),
  files: z.object({
    dir: z.string().describe("Absolute or relative path to the local files directory.")
  }).optional(),
  mcp: z.object({
    chromeDevtools: z.object({
      enabled: z.boolean().default(false),
      command: z.string().default("npx"),
      args: z.array(z.string()).default(["-y", "chrome-devtools-mcp@latest"]),
      toolPrefix: z.string().default("devtools_")
    }).default({
      enabled: false,
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest"],
      toolPrefix: "devtools_"
    }),
    servers: z.array(z.object({
      name: z.string(),
      transport: z.enum(["stdio", "sse", "http"]).default("stdio"),
      command: z.string().optional(),
      args: z.array(z.string()).default([]),
      url: z.string().optional(),
      toolPrefix: z.string().default(""),
      env: z.record(z.string(), z.string()).default({}),
      enabled: z.boolean().default(true),
      authType: z.enum(["none", "bearer", "header", "oauth"]).default("none"),
      bearerToken: z.string().optional(),
      headerName: z.string().optional(),
      headerValue: z.string().optional(),
      oauthClientId: z.string().optional(),
      oauthClientSecret: z.string().optional(),
      oauthIssuerUrl: z.string().optional(),
      oauthAuthorizationUrl: z.string().optional(),
      oauthTokenUrl: z.string().optional(),
      oauthScopes: z.string().optional(),
      oauthAccessToken: z.string().optional(),
      oauthRefreshToken: z.string().optional(),
      oauthTokenExpiresAt: z.number().optional()
    })).default([])
  }).default({
    chromeDevtools: {
      enabled: false,
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest"],
      toolPrefix: "devtools_"
    },
    servers: []
  })
});

export type SciraConfig = z.infer<typeof SciraConfigSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  kind: z.enum(["primary", "secondary", "vendor", "weak", "unknown"]).default("unknown"),
  summary: z.string().default(""),
  snapshotPath: z.string().optional(),
  createdAt: z.string()
});

export type Source = z.infer<typeof SourceSchema>;

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  status: z.enum(["draft", "verified", "weak", "contradicted", "needs_review"]).default("draft"),
  sourceIds: z.array(z.string()).default([]),
  reason: z.string().default(""),
  createdAt: z.string()
});

export type Claim = z.infer<typeof ClaimSchema>;

export type RunState = {
  id: string;
  path: string;
  goal: string;
  title?: string;
  sourceCount: number;
  claimCount: number;
  weakCount: number;
  reportDirty: boolean;
  updatedAt: number; // ms epoch of last activity (convo.json / report mtime)
  isFull: boolean; // true once the full research harness produced sources/claims
};
