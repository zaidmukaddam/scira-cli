import { gateway, type LanguageModel } from "ai";
import { createXai } from "@ai-sdk/xai";
import { createWorkersAI } from "workers-ai-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { SciraConfig } from "../../types/index.js";
import { hasEnv } from "./readiness.js";

export type LlmProvider = SciraConfig["llmProvider"];

/** Providers that run a local agent harness (their own tool loop + CLI) rather than a bare language model. */
export const HARNESS_PROVIDERS = ["claude-code", "codex"] as const;
export type HarnessProvider = (typeof HARNESS_PROVIDERS)[number];

export function isHarnessProvider(provider: LlmProvider): provider is HarnessProvider {
  return (HARNESS_PROVIDERS as readonly string[]).includes(provider);
}

export const LLM_PROVIDERS: LlmProvider[] = ["gateway", "xai", "workers-ai", "huggingface", "claude-code", "codex"];

/** Human-readable names for the provider picker and status messages. */
export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  gateway: "Vercel AI Gateway",
  xai: "xAI",
  "workers-ai": "Cloudflare Workers AI",
  huggingface: "HuggingFace",
  "claude-code": "Claude Code (local)",
  codex: "Codex (local)"
};

/** Env vars each LLM provider needs before it can generate. */
export const LLM_PROVIDER_ENV: Record<LlmProvider, string[]> = {
  gateway: ["AI_GATEWAY_API_KEY"],
  xai: ["XAI_API_KEY"],
  "workers-ai": ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
  huggingface: ["HF_API_KEY"],
  // Harness providers accept their native key OR the AI Gateway key (OR-checked
  // in requireLlmKeys, not the default AND-of-all logic).
  "claude-code": ["ANTHROPIC_API_KEY"],
  codex: ["OPENAI_API_KEY"]
};

export function defaultModelFor(provider: LlmProvider): string {
  switch (provider) {
    case "xai": return "grok-build-0.1";
    case "workers-ai": return "@cf/moonshotai/kimi-k2.6";
    case "huggingface": return "meta-llama/Llama-3.3-70B-Instruct";
    case "claude-code": return "claude-sonnet-4-6";
    case "codex": return "gpt-5.5";
    default: return "deepseek/deepseek-v4-flash";
  }
}

/** Throw a setup-oriented error when the active LLM provider's env keys are missing. */
export function requireLlmKeys(config: SciraConfig): void {
  if (isHarnessProvider(config.llmProvider)) {
    // No key required: the local harness uses the user's CLI login
    // (claude login / codex login). An explicit API key is optional.
    return;
  }
  const missing = LLM_PROVIDER_ENV[config.llmProvider].filter((name) => !hasEnv(name));
  if (missing.length > 0) {
    throw new Error(`${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} required for the "${config.llmProvider}" LLM provider. Set ${missing.length === 1 ? "it" : "them"} with /key or in your environment.`);
  }
}

/** Build the AI SDK language model for the configured provider + model id. */
export function getLanguageModel(config: SciraConfig): LanguageModel {
  requireLlmKeys(config);
  if (isHarnessProvider(config.llmProvider)) {
    throw new Error(`The "${config.llmProvider}" provider runs as a local agent harness, not a language model — drive it through the harness agent path, not getLanguageModel().`);
  }
  switch (config.llmProvider) {
    case "xai":
      return createXai({ apiKey: process.env.XAI_API_KEY })(config.model);
    case "workers-ai":
      return createWorkersAI({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
        apiKey: process.env.CLOUDFLARE_API_TOKEN!
      })(config.model);
    case "huggingface":
      return createOpenAICompatible({
        name: "huggingface",
        baseURL: "https://router.huggingface.co/v1",
        apiKey: process.env.HF_API_KEY
      })(config.model);
    default:
      return gateway(config.model);
  }
}
