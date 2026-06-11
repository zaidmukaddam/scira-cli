import React, { useCallback, useRef, useState } from "react";
import { SciraConfig } from "../../../types/index.js";
import { saveGlobalConfig } from "../../../config/load-config.js";
import { setEnvKey, isManagedEnvKey, MANAGED_ENV_KEYS } from "../../../config/env-store.js";
import { detectEnv, type SearchProvider } from "../../../providers/llm/readiness.js";
import { listModels } from "../../../providers/llm/models.js";
import { LLM_PROVIDERS, LLM_PROVIDER_LABELS, defaultModelFor, type LlmProvider } from "../../../providers/llm/registry.js";
import { type Screen, type FeedItem } from "../types.js";
import { PROVIDERS } from "../constants.js";
import { prettifyModelId } from "../lib/utils.js";
import { useMountEffect } from "../components/effects.js";

export type Menu = { type: "model" | "provider" | "llm"; items: string[]; index: number; loading?: boolean; query: string };

type SettingsOptions = {
  config: SciraConfig;
  setConfig: (next: SciraConfig) => void;
  screen: Screen;
  pushFeed: (item: FeedItem) => void;
  setNotice: (text: string) => void;
};

export function useSettings({ config, setConfig, screen, pushFeed, setNotice }: SettingsOptions): {
  menu: Menu | null;
  setMenu: React.Dispatch<React.SetStateAction<Menu | null>>;
  modelName: string;
  resolveModelName: (id: string) => void;
  openMenu: (type: "model" | "provider" | "llm") => Promise<void>;
  applyMenuSelection: (selected: Menu) => Promise<void>;
  handleSettings: (text: string) => Promise<string | null>;
} {
  const [menu, setMenu] = useState<Menu | null>(null);

  const modelsRef = useRef<Map<string, string>>(new Map());
  const [modelName, setModelName] = useState<string>(() => prettifyModelId(config.model));
  const currentModelIdRef = useRef(config.model);
  const resolveModelName = useCallback((id: string) => {
    currentModelIdRef.current = id;
    const cached = modelsRef.current.get(id);
    if (cached) { setModelName(cached); return; }
    setModelName(prettifyModelId(id));
    void listModels(config).then((models) => {
      const map = new Map<string, string>();
      for (const m of models) map.set(m.id, m.name && m.name.trim() ? m.name : prettifyModelId(m.id));
      modelsRef.current = map;
      if (currentModelIdRef.current === id) setModelName(map.get(id) ?? prettifyModelId(id));
    }).catch(() => { });
  }, [config]);
  useMountEffect(() => { resolveModelName(config.model); });

  const applyModel = useCallback(async (id: string) => {
    const next = { ...config, model: id, lastModels: { ...config.lastModels, [config.llmProvider]: id } };
    setConfig(next);
    resolveModelName(id);
    await saveGlobalConfig(next);
    return `Model set to ${id}.`;
  }, [config, resolveModelName, setConfig]);

  const applyProvider = useCallback(async (provider: SearchProvider) => {
    const next = { ...config, search: { ...config.search, provider } };
    setConfig(next);
    await saveGlobalConfig(next);
    return `Search provider set to ${provider}.`;
  }, [config, setConfig]);

  const applyLlmProvider = useCallback(async (provider: LlmProvider) => {
    if (provider === config.llmProvider) return `LLM provider already set to ${LLM_PROVIDER_LABELS[provider]}.`;
    const model = config.lastModels[provider] ?? defaultModelFor(provider);
    const next = {
      ...config,
      llmProvider: provider,
      model,
      lastModels: { ...config.lastModels, [config.llmProvider]: config.model }
    };
    setConfig(next);
    modelsRef.current = new Map();
    await saveGlobalConfig(next);
    return `LLM provider set to ${LLM_PROVIDER_LABELS[provider]} (model: ${model}).`;
  }, [config, setConfig]);

  const openMenu = useCallback(async (type: "model" | "provider" | "llm") => {
    if (type === "provider") {
      const idx = Math.max(0, PROVIDERS.indexOf(config.search.provider));
      setMenu({ type, items: PROVIDERS, index: idx, query: "" });
      return;
    }
    if (type === "llm") {
      const idx = Math.max(0, LLM_PROVIDERS.indexOf(config.llmProvider));
      setMenu({ type, items: LLM_PROVIDERS, index: idx, query: "" });
      return;
    }
    setMenu({ type: "model", items: [], index: 0, loading: true, query: "" });
    try {
      const models = await listModels(config);
      const ids = models.map((m) => m.id);
      const idx = Math.max(0, ids.indexOf(config.model));
      setMenu({ type: "model", items: ids, index: idx, query: "" });
    } catch (error) {
      setMenu(null);
      const msg = error instanceof Error ? error.message : String(error);
      if (screen === "chat") pushFeed({ kind: "status", text: msg }); else setNotice(msg);
    }
  }, [config, pushFeed, screen, setNotice]);

  const applyMenuSelection = useCallback(async (selected: Menu) => {
    const value = selected.items[selected.index];
    if (!value) return;
    const result = selected.type === "model"
      ? await applyModel(value)
      : selected.type === "llm"
        ? await applyLlmProvider(value as LlmProvider)
        : await applyProvider(value as SearchProvider);
    if (selected.type === "llm") resolveModelName(config.lastModels[value] ?? defaultModelFor(value as LlmProvider));
    if (screen === "chat") pushFeed({ kind: "status", text: result }); else setNotice(result);
  }, [applyModel, applyProvider, applyLlmProvider, resolveModelName, pushFeed, screen, setNotice, config.lastModels]);

  const handleSettings = useCallback(async (text: string): Promise<string | null> => {
    const parts = text.split(/\s+/u);
    const cmd = parts[0];
    const rest = parts.slice(1);
    const arg = rest.join(" ").trim();

    if (cmd === "/model") {
      if (!arg) return `Current model: ${config.model}`;
      const next = { ...config, model: arg, lastModels: { ...config.lastModels, [config.llmProvider]: arg } };
      setConfig(next);
      resolveModelName(arg);
      await saveGlobalConfig(next);
      return `Model set to ${arg}.`;
    }
    if (cmd === "/llm") {
      if (!arg) return `Current LLM provider: ${LLM_PROVIDER_LABELS[config.llmProvider]} (${config.llmProvider})\nOptions: ${LLM_PROVIDERS.join(", ")}`;
      if (!LLM_PROVIDERS.includes(arg as LlmProvider)) return `Unknown LLM provider "${arg}". Options: ${LLM_PROVIDERS.join(", ")}`;
      const result = await applyLlmProvider(arg as LlmProvider);
      resolveModelName(config.lastModels[arg] ?? defaultModelFor(arg as LlmProvider));
      return result;
    }
    if (cmd === "/provider") {
      if (!arg) return `Current search provider: ${config.search.provider}\nOptions: ${PROVIDERS.join(", ")}`;
      if (!PROVIDERS.includes(arg as SearchProvider)) return `Unknown provider "${arg}". Options: ${PROVIDERS.join(", ")}`;
      const next = { ...config, search: { ...config.search, provider: arg as SearchProvider } };
      setConfig(next);
      await saveGlobalConfig(next);
      return `Search provider set to ${arg}.`;
    }
    if (cmd === "/key") {
      const name = (rest[0] ?? "").toUpperCase();
      const value = rest.slice(1).join(" ").trim();
      if (!name || !value) return `Usage: /key <NAME> <value>\nManaged keys: ${MANAGED_ENV_KEYS.join(", ")}`;
      if (!isManagedEnvKey(name)) return `Unknown key "${name}". Managed keys: ${MANAGED_ENV_KEYS.join(", ")}`;
      await setEnvKey(name, value);
      return `${name} saved to ~/.scira/.env and active for this session.`;
    }
    if (cmd === "/keys") {
      return detectEnv(config.search.provider, config.llmProvider)
        .map((c) => `${c.present ? "set    " : "missing"} ${c.name}${c.required ? " (required)" : ""}`)
        .join("\n");
    }
    return null;
  }, [config, resolveModelName, setConfig, applyLlmProvider]);

  return { menu, setMenu, modelName, resolveModelName, openMenu, applyMenuSelection, handleSettings };
}
