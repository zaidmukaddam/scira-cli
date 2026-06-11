import process from "node:process";
import { Exa } from "exa-js";
import Parallel from "parallel-web";
import { Firecrawl } from "@mendable/firecrawl-js";
import { SciraConfig } from "../types/index.js";
import { hasEnv, requireSearchProvider, type SearchProvider } from "../providers/llm/readiness.js";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
};

type Provider = SearchProvider;

// ── lazy singleton clients ──
let _exa: Exa | undefined;
let _parallel: Parallel | undefined;
let _firecrawl: Firecrawl | undefined;

function getExa(): Exa {
  requireSearchProvider("exa");
  if (!_exa) _exa = new Exa(process.env.EXA_API_KEY);
  return _exa;
}

function getParallel(): Parallel {
  requireSearchProvider("parallel");
  if (!_parallel) _parallel = new Parallel({ apiKey: process.env.PARALLEL_API_KEY });
  return _parallel;
}

function getFirecrawl(): Firecrawl {
  requireSearchProvider("firecrawl");
  if (!_firecrawl) _firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
  return _firecrawl;
}

// ── helpers (mirrored from scira) ──
function extractDomain(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "";
  const match = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/iu);
  return match?.[1] || url;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\[.*?\]/gu, "")
    .replace(/\(.*?\)/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function deduplicateByDomainAndUrl<T extends { url: string }>(items: T[]): T[] {
  const seenDomains = new Set<string>();
  const seenUrls = new Set<string>();
  return items.filter((item) => {
    const domain = extractDomain(item.url);
    if (!seenUrls.has(item.url) && !seenDomains.has(domain)) {
      seenUrls.add(item.url);
      seenDomains.add(domain);
      return true;
    }
    return false;
  });
}

export type QueryOptions = {
  maxResults?: number;
  topic?: "general" | "news";
  quality?: "default" | "best";
  startDate?: string | null;
};

// ── provider strategies ──
async function parallelSearch(query: string, config: SciraConfig, opts: QueryOptions = {}): Promise<SearchResult[]> {
  const parallel = getParallel();
  const maxResults = opts.maxResults ?? config.search.maxResults;
  const startDate = opts.startDate ?? config.search.afterDate;
  const response = await parallel.search({
    objective: query,
    search_queries: [query],
    mode: opts.quality === "best" ? "advanced" : "basic",
    max_chars_total: config.search.maxCharsTotal ?? 5000,
    advanced_settings: {
      max_results: Math.max(maxResults, 10),
      fetch_policy: { max_age_seconds: config.search.maxAgeSeconds ?? 3600, timeout_seconds: 120 },
      ...(startDate ? { source_policy: { after_date: startDate } } : {})
    }
  });
  const results = (response.results ?? []).map((r): SearchResult => ({
    url: r.url,
    title: cleanTitle(r.title ?? ""),
    snippet: (r.excerpts ?? []).join(" ").slice(0, 1000),
    publishedDate: r.publish_date ?? undefined
  }));
  return deduplicateByDomainAndUrl(results);
}

async function exaSearch(query: string, config: SciraConfig, opts: QueryOptions = {}): Promise<SearchResult[]> {
  const exa = getExa();
  const maxResults = opts.maxResults ?? config.search.maxResults;
  const startDate = opts.startDate ?? config.search.afterDate;
  const startPublishedDate = startDate ? new Date(startDate).toISOString() : undefined;
  const response = await exa.search(query, {
    type: opts.quality === "best" ? "deep" : "auto",
    numResults: Math.max(maxResults, 15),
    ...(startPublishedDate ? { startPublishedDate, endPublishedDate: new Date().toISOString() } : {}),
    contents: { highlights: true }
  });
  const results = (response.results ?? []).map((r): SearchResult => {
    const highlights = (r as { highlights?: string[] }).highlights ?? [];
    return {
      url: r.url,
      title: cleanTitle(r.title ?? ""),
      snippet: highlights.join(" ").slice(0, 1000),
      publishedDate: (r as { publishedDate?: string }).publishedDate ?? undefined
    };
  });
  return deduplicateByDomainAndUrl(results);
}

async function firecrawlSearch(query: string, config: SciraConfig, opts: QueryOptions = {}): Promise<SearchResult[]> {
  const firecrawl = getFirecrawl();
  const maxResults = opts.maxResults ?? config.search.maxResults;
  const startDate = opts.startDate ?? config.search.afterDate;
  const topic = opts.topic ?? "general";

  const formatTbs = (d: string) => {
    const dt = new Date(d);
    const end = new Date();
    return `cdr:1,cd_min:${dt.getMonth()+1}/${dt.getDate()}/${dt.getFullYear()},cd_max:${end.getMonth()+1}/${end.getDate()}/${end.getFullYear()}`;
  };

  const sources: ("web" | "news")[] = topic === "news" ? ["news", "web"] : ["web"];
  const data = await firecrawl.search(query, {
    sources,
    limit: maxResults,
    ...(startDate ? { tbs: formatTbs(startDate) } : {}),
    ...(config.search.includeDomains.length ? { includeDomains: config.search.includeDomains } : {}),
    ...(config.search.excludeDomains.length ? { excludeDomains: config.search.excludeDomains } : {})
  });

  const web = (data.web ?? []).filter(
    (item): item is { url: string; title?: string; description?: string } =>
      typeof (item as { url?: unknown }).url === "string"
  );
  const news = topic === "news"
    ? (data.news ?? []).filter(
        (item): item is { url: string; title?: string; snippet?: string; date?: string } =>
          typeof (item as { url?: unknown }).url === "string"
      )
    : [];

  const results: SearchResult[] = [
    ...news.map((r) => ({ url: r.url, title: cleanTitle(r.title ?? ""), snippet: (r.snippet ?? "").slice(0, 1000), publishedDate: r.date })),
    ...web.map((r) => ({ url: r.url, title: cleanTitle(r.title ?? ""), snippet: (r.description ?? "").slice(0, 1000) }))
  ];
  return deduplicateByDomainAndUrl(results);
}

const STRATEGIES: Record<Provider, (query: string, config: SciraConfig, opts?: QueryOptions) => Promise<SearchResult[]>> = {
  parallel: parallelSearch,
  exa: exaSearch,
  firecrawl: firecrawlSearch
};

export type MultiSearchResult = {
  query: string;
  results: SearchResult[];
};


export async function multiSearchWeb(
  queries: string[],
  perQuery: QueryOptions[],
  config: SciraConfig
): Promise<MultiSearchResult[]> {
  const provider = config.search.provider;
  const strategy = STRATEGIES[provider];

  const settled = await Promise.allSettled(
    queries.map((q, i) => strategy(q, config, perQuery[i] ?? {}))
  );

  const searches: MultiSearchResult[] = await Promise.all(
    settled.map(async (res, i) => {
      if (res.status === "fulfilled" && res.value.length > 0) {
        return { query: queries[i], results: res.value };
      }
      // per-query fallback to Firecrawl
      if (provider !== "firecrawl" && hasEnv("FIRECRAWL_API_KEY")) {
        try {
          const fallback = await firecrawlSearch(queries[i], config, perQuery[i] ?? {});
          return { query: queries[i], results: fallback };
        } catch { /* ignore */ }
      }
      return { query: queries[i], results: [] };
    })
  );

  return searches;
}
