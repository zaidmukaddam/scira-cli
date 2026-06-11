#!/usr/bin/env bun
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { detectEnv, type SearchProvider } from "../../providers/llm/readiness.js";
import { listModels } from "../../providers/llm/models.js";
import { LLM_PROVIDERS, LLM_PROVIDER_LABELS, defaultModelFor, type LlmProvider } from "../../providers/llm/registry.js";
import type { SciraConfig } from "../../types/index.js";

const SCIRA_DIR = join(homedir(), ".scira");
const ENV_FILE = join(SCIRA_DIR, ".env");
const CONFIG_FILE = join(SCIRA_DIR, "config.json");

const SEARCH_PROVIDERS: SearchProvider[] = ["parallel", "exa", "firecrawl"];

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

export async function initCommand() {
  p.intro("Welcome to Scira!");

  // Create .scira directory if it doesn't exist
  await mkdir(SCIRA_DIR, { recursive: true });

  // Read existing .env and config
  const existingEnv = existsSync(ENV_FILE) ? parseEnvFile(await readFile(ENV_FILE, "utf8")) : {};
  const existingConfig = existsSync(CONFIG_FILE) ? JSON.parse(await readFile(CONFIG_FILE, "utf8")) as Partial<SciraConfig> : null;

  // Ask if user wants to reconfigure
  const shouldReconfigure = existingConfig ? await p.confirm({
    message: "Configuration already exists. Reconfigure?",
    initialValue: false,
  }) : true;

  if (p.isCancel(shouldReconfigure)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // If not reconfiguring and config exists, just verify and exit
  if (!shouldReconfigure && existingConfig) {
    p.note("Using existing configuration", "Configuration");
    p.log.success(`LLM Provider: ${LLM_PROVIDER_LABELS[existingConfig.llmProvider || "gateway"]}`);
    p.log.success(`Model: ${existingConfig.model || "default"}`);
    p.log.success(`Search Provider: ${existingConfig.search?.provider || "exa"}`);

    // Verify credentials
    p.note("Verifying your setup...", "Verification");
    const s = p.spinner();
    s.start("Checking credentials...");
    const checks = detectEnv(existingConfig.search?.provider || "exa", existingConfig.llmProvider || "gateway");
    const missingRequired = checks.filter((c) => c.required && !c.present);

    if (missingRequired.length === 0) {
      s.stop("All credentials present!");
    } else {
      s.stop(`Missing: ${missingRequired.map((c) => c.name).join(", ")}`);
      p.note("Some required credentials are missing. Run `scira init` again to reconfigure.", "Warning");
    }

    p.outro("Configuration is up to date!");
    return;
  }

  // Step 1: LLM Provider
  p.note("Choose your LLM provider", "LLM Provider");

  const llmProvider = await p.select({
    message: "Select LLM provider",
    options: LLM_PROVIDERS.map((provider) => ({
      value: provider,
      label: LLM_PROVIDER_LABELS[provider],
    })),
    initialValue: existingConfig?.llmProvider || "gateway",
  });

  if (p.isCancel(llmProvider)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Step 2: API Keys based on provider
  p.note("Scira requires API keys to function. Let's set them up.", "API Keys");

  const envKeys: Record<string, string> = { ...existingEnv };

  if (llmProvider === "gateway") {
    if (!envKeys.AI_GATEWAY_API_KEY || shouldReconfigure) {
      const aiGatewayKey = await p.text({
        message: envKeys.AI_GATEWAY_API_KEY ? "Enter your Vercel AI Gateway API key (current: *****)" : "Enter your Vercel AI Gateway API key",
        placeholder: "sk-...",
        defaultValue: envKeys.AI_GATEWAY_API_KEY,
        validate: (value) => {
          if (!value) return "AI Gateway API key is required";
          if (!value.startsWith("sk-")) return "Invalid API key format";
        },
      });

      if (p.isCancel(aiGatewayKey)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      envKeys.AI_GATEWAY_API_KEY = aiGatewayKey;
    } else {
      p.log.success("AI Gateway API key already set");
    }
  } else if (llmProvider === "xai") {
    if (!envKeys.XAI_API_KEY || shouldReconfigure) {
      const xaiKey = await p.text({
        message: envKeys.XAI_API_KEY ? "Enter your xAI API key (current: *****)" : "Enter your xAI API key",
        placeholder: "sk-...",
        defaultValue: envKeys.XAI_API_KEY,
        validate: (value) => {
          if (!value) return "xAI API key is required";
        },
      });

      if (p.isCancel(xaiKey)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      envKeys.XAI_API_KEY = xaiKey;
    } else {
      p.log.success("xAI API key already set");
    }
  } else if (llmProvider === "workers-ai") {
    if (!envKeys.CLOUDFLARE_ACCOUNT_ID || !envKeys.CLOUDFLARE_API_TOKEN || shouldReconfigure) {
      const accountId = await p.text({
        message: envKeys.CLOUDFLARE_ACCOUNT_ID ? "Enter your Cloudflare Account ID (current: *****)" : "Enter your Cloudflare Account ID",
        placeholder: "your-account-id",
        defaultValue: envKeys.CLOUDFLARE_ACCOUNT_ID,
        validate: (value) => {
          if (!value) return "Cloudflare Account ID is required";
        },
      });

      if (p.isCancel(accountId)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      const apiToken = await p.text({
        message: envKeys.CLOUDFLARE_API_TOKEN ? "Enter your Cloudflare API Token (current: *****)" : "Enter your Cloudflare API Token",
        placeholder: "your-api-token",
        defaultValue: envKeys.CLOUDFLARE_API_TOKEN,
        validate: (value) => {
          if (!value) return "Cloudflare API Token is required";
        },
      });

      if (p.isCancel(apiToken)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      envKeys.CLOUDFLARE_ACCOUNT_ID = accountId;
      envKeys.CLOUDFLARE_API_TOKEN = apiToken;
    } else {
      p.log.success("Cloudflare credentials already set");
    }
  } else if (llmProvider === "huggingface") {
    if (!envKeys.HF_API_KEY || shouldReconfigure) {
      const hfKey = await p.text({
        message: envKeys.HF_API_KEY ? "Enter your HuggingFace API key (current: *****)" : "Enter your HuggingFace API key",
        placeholder: "hf_...",
        defaultValue: envKeys.HF_API_KEY,
        validate: (value) => {
          if (!value) return "HuggingFace API key is required";
        },
      });

      if (p.isCancel(hfKey)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      envKeys.HF_API_KEY = hfKey;
    } else {
      p.log.success("HuggingFace API key already set");
    }
  }

  // Optional search provider keys
  const searchProvider = await p.select({
    message: "Select search provider",
    options: SEARCH_PROVIDERS.map((provider) => ({
      value: provider,
      label: provider.charAt(0).toUpperCase() + provider.slice(1),
    })),
    initialValue: existingConfig?.search?.provider || "exa",
  });

  if (p.isCancel(searchProvider)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (searchProvider === "exa") {
    if (!envKeys.EXA_API_KEY || shouldReconfigure) {
      const exaKey = await p.text({
        message: envKeys.EXA_API_KEY ? "Enter your Exa API key (optional, current: *****)" : "Enter your Exa API key (optional, press Enter to skip)",
        placeholder: "exa_...",
        defaultValue: envKeys.EXA_API_KEY,
      });

      if (p.isCancel(exaKey)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      if (exaKey) envKeys.EXA_API_KEY = exaKey;
    } else {
      p.log.success("Exa API key already set");
    }
  } else if (searchProvider === "firecrawl") {
    if (!envKeys.FIRECRAWL_API_KEY || shouldReconfigure) {
      const firecrawlKey = await p.text({
        message: envKeys.FIRECRAWL_API_KEY ? "Enter your Firecrawl API key (optional, current: *****)" : "Enter your Firecrawl API key (optional, press Enter to skip)",
        placeholder: "fc-...",
        defaultValue: envKeys.FIRECRAWL_API_KEY,
      });

      if (p.isCancel(firecrawlKey)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      if (firecrawlKey) envKeys.FIRECRAWL_API_KEY = firecrawlKey;
    } else {
      p.log.success("Firecrawl API key already set");
    }
  }

  // Write .env file
  const envContent = Object.entries(envKeys)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  await writeFile(ENV_FILE, envContent, "utf8");
  p.log.success("API keys saved to ~/.scira/.env");

  // Step 3: Model Selection
  p.note("Select your AI model", "Model");

  const s = p.spinner();
  s.start("Fetching available models...");

  let models: string[] = [];
  try {
    const tempConfig: SciraConfig = {
      theme: "auto",
      llmProvider: llmProvider as LlmProvider,
      model: defaultModelFor(llmProvider as LlmProvider),
      lastModels: {},
      approvalMode: "suggest",
      runDirectory: ".scira/runs",
      maxSources: 20,
      citationPolicy: "strict",
      search: {
        provider: searchProvider as SearchProvider,
        maxResults: 8,
        includeDomains: [],
        excludeDomains: [],
      },
      mcp: {
        chromeDevtools: {
          enabled: false,
          command: "npx",
          args: ["-y", "chrome-devtools-mcp@latest"],
          toolPrefix: "devtools_",
        },
        servers: [],
      },
    };

    const modelList = await listModels(tempConfig);
    models = modelList.map((m) => m.id);
    s.stop(`Found ${models.length} models`);
  } catch (error) {
    s.stop("Failed to fetch models, using default");
    models = [defaultModelFor(llmProvider as LlmProvider)];
  }

  const model = await p.select({
    message: "Select AI model",
    options: models.map((m) => ({ value: m, label: m })),
    initialValue: existingConfig?.model || defaultModelFor(llmProvider as LlmProvider),
  });

  if (p.isCancel(model)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Step 4: Config
  p.note("Configure your research preferences.", "Configuration");

  const approvalMode = await p.select({
    message: "Select tool approval mode",
    options: [
      { value: "suggest", label: "Suggest (ask before expensive actions)" },
      { value: "manual", label: "Manual (ask before every action)" },
      { value: "auto", label: "Auto (run without asking)" },
    ],
    initialValue: existingConfig?.approvalMode || "suggest",
  });

  if (p.isCancel(approvalMode)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const maxSources = await p.text({
    message: "Maximum sources per run",
    defaultValue: String(existingConfig?.maxSources || 20),
    placeholder: "20",
    validate: (value) => {
      const num = Number.parseInt(value || "", 10);
      if (Number.isNaN(num) || num < 1) return "Must be a positive number";
    },
  });

  if (p.isCancel(maxSources)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const citationPolicy = await p.select({
    message: "Select citation policy",
    options: [
      { value: "strict", label: "Strict (all claims must be cited)" },
      { value: "balanced", label: "Balanced (citations for major claims)" },
    ],
    initialValue: existingConfig?.citationPolicy || "strict",
  });

  if (p.isCancel(citationPolicy)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Write config file
  const config: SciraConfig = {
    theme: existingConfig?.theme ?? "auto",
    llmProvider: llmProvider as LlmProvider,
    model,
    lastModels: { [llmProvider as LlmProvider]: model, ...(existingConfig?.lastModels || {}) },
    approvalMode: approvalMode as "manual" | "suggest" | "auto",
    search: {
      provider: searchProvider as SearchProvider,
      maxResults: existingConfig?.search?.maxResults || 8,
      includeDomains: existingConfig?.search?.includeDomains || [],
      excludeDomains: existingConfig?.search?.excludeDomains || [],
    },
    maxSources: Number.parseInt(maxSources, 10),
    citationPolicy: citationPolicy as "strict" | "balanced",
    runDirectory: existingConfig?.runDirectory || ".scira/runs",
    mcp: existingConfig?.mcp || {
      chromeDevtools: {
        enabled: false,
        command: "npx",
        args: ["-y", "chrome-devtools-mcp@latest"],
        toolPrefix: "devtools_",
      },
      servers: [],
    },
  };

  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  p.log.success("Configuration saved to ~/.scira/config.json");

  // Step 5: Verify
  p.note("Verifying your setup...", "Verification");

  const s2 = p.spinner();
  s2.start("Checking credentials...");

  // Load the config we just created
  const checks = detectEnv(config.search.provider, config.llmProvider);
  const missingRequired = checks.filter((c) => c.required && !c.present);

  if (missingRequired.length === 0) {
    s2.stop("All credentials present!");
  } else {
    s2.stop(`Missing: ${missingRequired.map((c) => c.name).join(", ")}`);
    p.note("Some required credentials are missing. Please run `scira init` again.", "Warning");
  }

  p.outro("Setup complete! Run `scira doctor` to verify your configuration.");
}
