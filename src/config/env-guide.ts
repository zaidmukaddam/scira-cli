import type { ManagedEnvKey } from "./env-store.js";
import type { EnvCheck } from "../providers/llm/readiness.js";

export type EnvKeyGuide = {
  name: ManagedEnvKey;
  label: string;
  signupUrl: string;
  docsUrl?: string;
  steps: string[];
  placeholder: string;
};

export const ENV_KEY_GUIDES: Record<ManagedEnvKey, EnvKeyGuide> = {
  AI_GATEWAY_API_KEY: {
    name: "AI_GATEWAY_API_KEY",
    label: "Vercel AI Gateway",
    signupUrl: "https://vercel.com/docs/ai-gateway",
    docsUrl: "https://vercel.com/docs/ai-gateway/authentication",
    placeholder: "sk-...",
    steps: [
      "Sign in at vercel.com (free tier works).",
      "Open your team dashboard → AI Gateway → API Keys.",
      "Create a key and paste it here (starts with vc_)."
    ]
  },
  ANTHROPIC_API_KEY: {
    name: "ANTHROPIC_API_KEY",
    label: "Anthropic (Claude Code)",
    signupUrl: "https://console.anthropic.com/",
    docsUrl: "https://docs.anthropic.com/en/api/overview",
    placeholder: "sk-ant-...",
    steps: [
      "Create an account at console.anthropic.com.",
      "Open Settings → API Keys → Create Key.",
      "Paste the key here (starts with sk-ant-). Powers the local Claude Code harness."
    ]
  },
  OPENAI_API_KEY: {
    name: "OPENAI_API_KEY",
    label: "OpenAI (Codex)",
    signupUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs/api-reference",
    placeholder: "sk-...",
    steps: [
      "Create an account at platform.openai.com.",
      "Open API keys → Create new secret key.",
      "Paste the key here (starts with sk-). Powers the local Codex harness."
    ]
  },
  XAI_API_KEY: {
    name: "XAI_API_KEY",
    label: "xAI (Grok)",
    signupUrl: "https://console.x.ai/",
    docsUrl: "https://docs.x.ai/docs/overview",
    placeholder: "xai-...",
    steps: [
      "Create an account at console.x.ai.",
      "Open API Keys in the sidebar.",
      "Create a key and paste it here."
    ]
  },
  CLOUDFLARE_ACCOUNT_ID: {
    name: "CLOUDFLARE_ACCOUNT_ID",
    label: "Cloudflare account ID",
    signupUrl: "https://dash.cloudflare.com/",
    docsUrl: "https://developers.cloudflare.com/workers-ai/get-started/rest-api/",
    placeholder: "32-character account id",
    steps: [
      "Sign in at dash.cloudflare.com.",
      "Copy Account ID from the Workers & Pages overview (right-hand sidebar)."
    ]
  },
  CLOUDFLARE_API_TOKEN: {
    name: "CLOUDFLARE_API_TOKEN",
    label: "Cloudflare API token",
    signupUrl: "https://dash.cloudflare.com/profile/api-tokens",
    docsUrl: "https://developers.cloudflare.com/workers-ai/get-started/rest-api/",
    placeholder: "cloudflare api token",
    steps: [
      "Go to My Profile → API Tokens → Create Token.",
      "Use the \"Edit Cloudflare Workers AI\" template (or Workers AI Read).",
      "Create the token and paste it here."
    ]
  },
  HF_API_KEY: {
    name: "HF_API_KEY",
    label: "Hugging Face Inference",
    signupUrl: "https://huggingface.co/settings/tokens",
    docsUrl: "https://huggingface.co/docs/inference-providers/index",
    placeholder: "hf_...",
    steps: [
      "Create a Hugging Face account.",
      "Open Settings → Access Tokens → Create new token.",
      "Choose a token with Inference permissions and paste it here."
    ]
  },
  EXA_API_KEY: {
    name: "EXA_API_KEY",
    label: "Exa search",
    signupUrl: "https://dashboard.exa.ai/api-keys",
    docsUrl: "https://docs.exa.ai/reference/getting-started",
    placeholder: "exa_...",
    steps: [
      "Sign up at dashboard.exa.ai.",
      "Open API Keys and create a key.",
      "Paste the key here (starts with exa_)."
    ]
  },
  FIRECRAWL_API_KEY: {
    name: "FIRECRAWL_API_KEY",
    label: "Firecrawl search + scrape",
    signupUrl: "https://www.firecrawl.dev/app/api-keys",
    docsUrl: "https://docs.firecrawl.dev/introduction",
    placeholder: "fc-...",
    steps: [
      "Sign up at firecrawl.dev.",
      "Open the dashboard → API Keys.",
      "Create a key and paste it here."
    ]
  },
  PARALLEL_API_KEY: {
    name: "PARALLEL_API_KEY",
    label: "Parallel search",
    signupUrl: "https://platform.parallel.ai/",
    docsUrl: "https://docs.parallel.ai/search/search-quickstart",
    placeholder: "parallel api key",
    steps: [
      "Sign up at platform.parallel.ai.",
      "Open API Keys in the dashboard.",
      "Create a key and paste it here."
    ]
  }
};

export function envFileSetupInstructions(): string {
  return [
    "Where to save keys (pick one):",
    "  ~/.scira/.env          global — works from any directory",
    "  <project>/.scira/.env  project — overrides global when run from that folder",
    "",
    "Quick setup:",
    "  scira init             interactive wizard (saves to ~/.scira/.env)",
    "  cp .env.example ~/.scira/.env   then edit the file",
    "  scira doctor           verify keys are detected"
  ].join("\n");
}

export function formatKeyGuide(name: ManagedEnvKey): string {
  const guide = ENV_KEY_GUIDES[name];
  const lines = [
    `${guide.label} (${guide.name})`,
    `Get a key: ${guide.signupUrl}`,
    ...guide.steps.map((step, i) => `  ${i + 1}. ${step}`)
  ];
  if (guide.docsUrl) lines.push(`Docs: ${guide.docsUrl}`);
  return lines.join("\n");
}

export function isManagedEnvKeyName(name: string): name is ManagedEnvKey {
  return name in ENV_KEY_GUIDES;
}

export function formatMissingKeysHelp(checks: EnvCheck[]): string {
  const missing = checks.filter((c) => c.required && !c.present);
  if (missing.length === 0) return "";

  const blocks: string[] = ["Missing required keys:", ""];
  for (const check of missing) {
    if (!isManagedEnvKeyName(check.name)) {
      blocks.push(`${check.name} — ${check.purpose}`);
      continue;
    }
    blocks.push(formatKeyGuide(check.name));
    blocks.push("");
  }
  blocks.push(envFileSetupInstructions());
  return blocks.join("\n");
}

export function formatKeysStatus(checks: EnvCheck[]): string {
  const lines = checks.map((c) => {
    const status = c.present ? "set    " : "missing";
    const tag = c.required ? " (required)" : " (optional)";
    let line = `${status} ${c.name}${tag}  — ${c.purpose}`;
    if (!c.present && isManagedEnvKeyName(c.name)) {
      line += `\n         ${ENV_KEY_GUIDES[c.name].signupUrl}`;
    }
    return line;
  });
  return `${lines.join("\n")}\n\n${envFileSetupInstructions()}`;
}
