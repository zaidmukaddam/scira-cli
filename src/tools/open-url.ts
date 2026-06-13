import process from "node:process";
import { join } from "node:path";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { Exa } from "exa-js";
import Parallel from "parallel-web";
import { Firecrawl } from "@mendable/firecrawl-js";
import { SciraConfig } from "../types/index.js";
import { requireSearchProvider, type SearchProvider } from "../providers/llm/readiness.js";

export type ExtractedPage = {
  title: string;
  text: string;
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

// ── provider extractors ──
async function parallelExtract(url: string, config: SciraConfig): Promise<ExtractedPage | undefined> {
  const parallel = getParallel();
  const response = await parallel.extract({
    urls: [url],
    max_chars_total: config.search.maxCharsTotal ?? 10000,
    advanced_settings: { full_content: true }
  });
  const result = response.results?.[0];
  if (!result) return undefined;
  const text = (result.full_content ?? "") || (result.excerpts ?? []).join("\n\n");
  if (!text.trim()) return undefined;
  return { title: result.title ?? url, text: text.trim() };
}

async function exaExtract(url: string): Promise<ExtractedPage | undefined> {
  const exa = getExa();
  const response = await exa.getContents([url], { text: true });
  const result = response.results?.[0] as { title?: string; text?: string } | undefined;
  if (!result?.text?.trim()) return undefined;
  return { title: result.title ?? url, text: result.text.trim() };
}

async function firecrawlScrape(url: string): Promise<ExtractedPage | undefined> {
  const firecrawl = getFirecrawl();
  const doc = await firecrawl.scrape(url, { formats: ["markdown"] });
  const text = doc.markdown ?? doc.summary ?? "";
  if (!text.trim()) return undefined;
  return { title: doc.metadata?.title ?? url, text: text.trim() };
}

const EXTRACTORS: Record<Provider, (url: string, config: SciraConfig) => Promise<ExtractedPage | undefined>> = {
  parallel: (url, config) => parallelExtract(url, config),
  exa: (url) => exaExtract(url),
  firecrawl: (url) => firecrawlScrape(url)
};

// ── raw fetch + readability fallback ──
async function rawFetch(url: string): Promise<ExtractedPage> {
  const response = await fetch(url, { headers: { "user-agent": "scira-cli/0.1" } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  return {
    title: article?.title ?? dom.window.document.title ?? url,
    text: article?.textContent?.trim() || dom.window.document.body.textContent?.trim() || ""
  };
}

export async function openUrl(url: string, config: SciraConfig): Promise<ExtractedPage> {
  const provider = config.search.provider;
  try {
    const page = await EXTRACTORS[provider](url, config);
    if (page) return page;
  } catch {
    // fall through to raw fetch
  }
  return rawFetch(url);
}

export async function writeSnapshot(snapshotsDir: string, sourceId: string, page: ExtractedPage): Promise<string> {
  const path = join(snapshotsDir, `${sourceId}.md`);
  await Bun.write(path, `# ${page.title}\n\n${page.text}\n`);
  return path;
}
