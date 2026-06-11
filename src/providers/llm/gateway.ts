import { generateText, gateway } from "ai";
import { SciraConfig } from "../../types/index.js";
import { getLanguageModel, requireLlmKeys, defaultModelFor } from "./registry.js";

export type GatewayModel = {
  id: string;
  name?: string;
  type?: string;
  tags?: string[];
};

async function fetchModelsRaw(): Promise<GatewayModel[]> {
  const headers: Record<string, string> = {};
  if (process.env.AI_GATEWAY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.AI_GATEWAY_API_KEY}`;
  }
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`models endpoint returned ${response.status} ${response.statusText}`);
  }
  const payload = await response.json() as { data?: GatewayModel[] };
  return payload.data ?? [];
}

async function fetchModelsViaSdk(): Promise<GatewayModel[]> {
  const result = await gateway.getAvailableModels();
  return result.models.map((m): GatewayModel => ({
    id: m.id,
    name: m.name,
    // SDK list exposes modelType but no capability tags
    type: (m as { modelType?: string }).modelType
  }));
}

export async function listGatewayModels(providerPrefix?: string): Promise<GatewayModel[]> {
  let models: GatewayModel[];
  try {
    models = await fetchModelsRaw();
  } catch {
    // Raw endpoint can fail (network/TLS); fall back to the SDK transport that
    // already works for generation. This list lacks capability tags.
    models = await fetchModelsViaSdk();
  }
  return providerPrefix ? models.filter((model) => model.id.startsWith(`${providerPrefix}/`)) : models;
}

/**
 * Only text models that can use tools — the rest (image, video, embedding,
 * reranking, or chat models without tool-use) cannot drive the research agent.
 * When capability tags are unavailable (SDK fallback), accept any language model.
 */
export function isToolUseModel(model: GatewayModel): boolean {
  if (model.type !== "language") return false;
  return model.tags === undefined ? true : model.tags.includes("tool-use");
}

export async function listToolUseModels(providerPrefix?: string): Promise<GatewayModel[]> {
  return (await listGatewayModels(providerPrefix)).filter(isToolUseModel);
}

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export async function chooseConfiguredModel(config: SciraConfig): Promise<string> {
  requireLlmKeys(config);
  return config.model || defaultModelFor(config.llmProvider);
}

export async function generateWithGateway(config: SciraConfig, prompt: string, system?: string): Promise<string> {
  const result = await generateText({
    model: getLanguageModel(config),
    system,
    prompt
  });
  return result.text;
}
