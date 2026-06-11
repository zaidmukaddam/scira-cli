export type HuggingFaceModel = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
  };
  providers: Array<{
    provider: string;
    status: string;
    supports_tools?: boolean;
    supports_structured_output?: boolean;
  }>;
};

async function fetchModelsRaw(): Promise<HuggingFaceModel[]> {
  const headers: Record<string, string> = {};
  if (process.env.HF_API_KEY) {
    headers.Authorization = `Bearer ${process.env.HF_API_KEY}`;
  }
  const response = await fetch("https://router.huggingface.co/v1/models", {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`HuggingFace models endpoint returned ${response.status} ${response.statusText}`);
  }
  const payload = await response.json() as { data?: HuggingFaceModel[] };
  return payload.data ?? [];
}

export async function listHuggingFaceModels(): Promise<HuggingFaceModel[]> {
  const allModels = await fetchModelsRaw();
  return allModels.filter(isToolUseModel);
}

/**
 * Only text models that can use tools — the rest (image, video, embedding,
 * reranking, or chat models without tool-use) cannot drive the research agent.
 */
export function isToolUseModel(model: HuggingFaceModel): boolean {
  // Must support text input
  if (!model.architecture.input_modalities.includes("text")) return false;
  // Must support text output
  if (!model.architecture.output_modalities.includes("text")) return false;
  // At least one provider must support tools
  return model.providers.some((p) => p.supports_tools === true);
}
