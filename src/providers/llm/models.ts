import { SciraConfig } from "../../types/index.js";
import { listToolUseModels } from "./gateway.js";
import { listHuggingFaceModels } from "./huggingface.js";
import { type LlmProvider } from "./registry.js";

export type LlmModel = { id: string; name?: string };

/** Curated fallbacks so the /model picker keeps working when the live list call fails. */
const STATIC_MODELS: Record<Exclude<LlmProvider, "gateway">, LlmModel[]> = {
  xai: [
    { id: "grok-build-0.1", name: "Grok Build 0.1" },
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-4-fast", name: "Grok 4 Fast" },
    { id: "grok-4-fast-non-reasoning", name: "Grok 4 Fast (Non-Reasoning)" },
    { id: "grok-3", name: "Grok 3" },
    { id: "grok-3-mini", name: "Grok 3 Mini" }
  ],
  "workers-ai": [
    { id: "@cf/moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct (fp8 fast)" },
    { id: "@cf/meta/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B Instruct" },
    { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B Instruct" },
    { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B Instruct" },
    { id: "@cf/openai/gpt-oss-120b", name: "GPT-OSS 120B" }
  ],
  huggingface: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
    { id: "meta-llama/Llama-3.1-70B-Instruct", name: "Llama 3.1 70B Instruct" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B Instruct" },
    { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B Instruct v0.3" },
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" }
  ]
};

async function listXaiModels(): Promise<LlmModel[]> {
  const key = process.env.XAI_API_KEY;
  if (!key) return STATIC_MODELS.xai;
  try {
    // OpenAI-compatible models endpoint
    const response = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`xAI models endpoint returned ${response.status}`);
    const payload = await response.json() as { data?: { id: string }[] };
    const models = (payload.data ?? []).map((m): LlmModel => ({ id: m.id }));
    return models.length > 0 ? models : STATIC_MODELS.xai;
  } catch {
    return STATIC_MODELS.xai;
  }
}

async function listWorkersAiModels(): Promise<LlmModel[]> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) return STATIC_MODELS["workers-ai"];
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?task=Text%20Generation&per_page=100`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Cloudflare models endpoint returned ${response.status}`);
    const payload = await response.json() as {
      result?: { name: string; description?: string; properties?: { property_id: string; value: string }[] }[];
    };
    const models = (payload.result ?? [])
      // prefer models that declare function calling; keep all if the flag is absent everywhere
      .map((m): LlmModel & { functionCalling: boolean } => ({
        id: m.name,
        functionCalling: (m.properties ?? []).some((p) => p.property_id === "function_calling" && p.value === "true")
      }));
    const toolCapable = models.filter((m) => m.functionCalling);
    const chosen = toolCapable.length > 0 ? toolCapable : models;
    return chosen.length > 0 ? chosen.map(({ id }) => ({ id })) : STATIC_MODELS["workers-ai"];
  } catch {
    return STATIC_MODELS["workers-ai"];
  }
}

async function listHuggingFaceModelsWrapper(): Promise<LlmModel[]> {
  const key = process.env.HF_API_KEY;
  if (!key) return STATIC_MODELS.huggingface;
  try {
    const models = await listHuggingFaceModels();
    return models.length > 0 ? models.map((m) => ({ id: m.id })) : STATIC_MODELS.huggingface;
  } catch {
    return STATIC_MODELS.huggingface;
  }
}

/** Model list for the active LLM provider (live where possible, static fallback otherwise). */
export async function listModels(config: SciraConfig): Promise<LlmModel[]> {
  switch (config.llmProvider) {
    case "xai": return listXaiModels();
    case "workers-ai": return listWorkersAiModels();
    case "huggingface": return listHuggingFaceModelsWrapper();
    default: return (await listToolUseModels()).map((m) => ({ id: m.id, name: m.name }));
  }
}
