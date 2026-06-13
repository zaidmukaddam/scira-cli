import process from "node:process";

export type SearchProvider = "parallel" | "exa" | "firecrawl";

export const PROVIDER_ENV: Record<SearchProvider, string> = {
  parallel: "PARALLEL_API_KEY",
  exa: "EXA_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY"
};

export const AI_GATEWAY_ENV = "AI_GATEWAY_API_KEY";

export function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function requireAiGatewayKey(): void {
  if (!hasEnv(AI_GATEWAY_ENV)) {
    throw new Error(`${AI_GATEWAY_ENV} is required for AI-powered research. Set it in your environment before running plans, searches, or reports.`);
  }
}

export function providerEnvVar(provider: SearchProvider): string {
  return PROVIDER_ENV[provider];
}

export function requireSearchProvider(provider: SearchProvider): void {
  const name = PROVIDER_ENV[provider];
  if (!hasEnv(name)) {
    throw new Error(`${name} is required for the "${provider}" search/scrape provider. Set it in your environment or switch search.provider in config.`);
  }
}

export type EnvCheck = {
  name: string;
  present: boolean;
  purpose: string;
  required: boolean;
};

type LlmEnvProvider = "gateway" | "xai" | "workers-ai" | "huggingface" | "claude-code" | "codex";

const LLM_ENV_CHECKS: { name: string; provider: LlmEnvProvider; purpose: string }[] = [
  { name: AI_GATEWAY_ENV, provider: "gateway", purpose: "Vercel AI Gateway LLM access" },
  { name: "ANTHROPIC_API_KEY", provider: "claude-code", purpose: "Claude Code (local harness) access" },
  { name: "OPENAI_API_KEY", provider: "codex", purpose: "Codex (local harness) access" },
  { name: "XAI_API_KEY", provider: "xai", purpose: "xAI (Grok) LLM access" },
  { name: "CLOUDFLARE_ACCOUNT_ID", provider: "workers-ai", purpose: "Cloudflare Workers AI account" },
  { name: "CLOUDFLARE_API_TOKEN", provider: "workers-ai", purpose: "Cloudflare Workers AI LLM access" },
  { name: "HF_API_KEY", provider: "huggingface", purpose: "HuggingFace Inference API access" }
];

export function detectEnv(provider: SearchProvider, llmProvider: LlmEnvProvider = "gateway"): EnvCheck[] {
  // Local harness providers authenticate via the CLI login, so their API key is optional.
  const harnessActive = llmProvider === "claude-code" || llmProvider === "codex";
  const checks: EnvCheck[] = LLM_ENV_CHECKS.map((c) => ({
    name: c.name,
    present: hasEnv(c.name),
    purpose: c.purpose,
    required: c.provider === llmProvider && !harnessActive
  }));
  for (const key of Object.keys(PROVIDER_ENV) as SearchProvider[]) {
    const name = PROVIDER_ENV[key];
    checks.push({
      name,
      present: hasEnv(name),
      purpose: `${key} web search + scrape`,
      required: key === provider
    });
  }
  return checks;
}
