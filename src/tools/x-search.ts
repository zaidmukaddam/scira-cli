import { generateText, tool, stepCountIs } from "ai";
import { xai } from "@ai-sdk/xai";
import { z } from "zod";
import { getTweet } from "react-tweet/api";
import { logEvent } from "../storage/run-store.js";

const XSEARCH_MODEL = "grok-4.20-0309-non-reasoning";

interface CitationSource {
  sourceType?: string;
  url?: string;
}

export interface XPost {
  url: string;
  id?: string;
  handle?: string;
  text?: string;
}

export interface XPostResult {
  query: string;
  dateRange: string;
  posts: XPost[];
  error?: string;
}

function sanitizeHandle(h: string): string {
  return h.replace(/^@+/u, "").trim();
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function extractTweetId(url: string): string | null {
  return url.match(/status\/(\d+)/u)?.[1] ?? null;
}

function canonicalLink(id: string | null, fallback: string): string {
  return id ? `https://x.com/i/status/${id}` : fallback;
}

export function createXSearchTool(runPath: string) {
  return tool({
    description:
      "Search X (formerly Twitter) for recent posts. Best for current events, public reactions, announcements, breaking news, and real-time opinions. Searches the last 7 days by default. Use 1–3 targeted queries per call.",
    inputSchema: z
      .object({
        queries: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe("Search queries for X posts. 1–3 targeted queries recommended."),
        startDate: z
          .string()
          .optional()
          .describe("Start date YYYY-MM-DD (default: 7 days ago)."),
        endDate: z
          .string()
          .optional()
          .describe("End date YYYY-MM-DD (default: today)."),
        includeXHandles: z
          .array(z.string())
          .max(10)
          .optional()
          .describe("Only include posts from these X handles (max 10). Cannot be combined with excludeXHandles."),
        excludeXHandles: z
          .array(z.string())
          .max(10)
          .optional()
          .describe("Exclude posts from these X handles (max 10). Cannot be combined with includeXHandles."),
      })
      .refine(
        (data) => {
          const hasInclude = data.includeXHandles && data.includeXHandles.length > 0;
          const hasExclude = data.excludeXHandles && data.excludeXHandles.length > 0;
          return !(hasInclude && hasExclude);
        },
        { message: "Cannot specify both includeXHandles and excludeXHandles", path: ["includeXHandles"] },
      ),
    execute: async ({ queries, startDate, endDate, includeXHandles, excludeXHandles }) => {
      await logEvent(runPath, "tool.xSearch", { queries });

      const today = new Date();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const effectiveStart = startDate?.trim() || toYMD(sevenDaysAgo);
      const effectiveEnd = endDate?.trim() || toYMD(today);
      const dateRange = `${effectiveStart} to ${effectiveEnd}`;

      const normalizedInclude = includeXHandles?.map(sanitizeHandle).filter(Boolean);
      const normalizedExclude = excludeXHandles?.map(sanitizeHandle).filter(Boolean);

      const results = await Promise.all(
        queries.map(async (query): Promise<XPostResult> => {
          try {
            const searchConfig: Parameters<typeof xai.tools.xSearch>[0] = {
              fromDate: effectiveStart,
              toDate: effectiveEnd,
            };
            if (normalizedInclude?.length) searchConfig.allowedXHandles = normalizedInclude;
            if (normalizedExclude?.length) searchConfig.excludedXHandles = normalizedExclude;

            const { sources } = await generateText({
              model: xai.responses(XSEARCH_MODEL),
              system: "Run the x_search tool for the given query and stop immediately. Do not output any text.",
              messages: [{ role: "user", content: query }],
              maxOutputTokens: 5,
              stopWhen: stepCountIs(1),
              tools: { x_search: xai.tools.xSearch(searchConfig) },
            });

            const citations = (Array.isArray(sources) ? sources : []) as CitationSource[];

            // Deduplicate citation URLs within this query before fetching
            const seenIds = new Set<string>();
            const uniqueCitations = citations.filter((c) => {
              if (c.sourceType !== "url" || !c.url) return false;
              const id = extractTweetId(c.url) ?? c.url;
              if (seenIds.has(id)) return false;
              seenIds.add(id);
              return true;
            });

            // Hydrate each citation URL with full tweet content
            const posts = (
              await Promise.all(
                uniqueCitations.map(async (c): Promise<XPost | null> => {
                  const rawUrl = c.url!;
                  const tweetId = extractTweetId(rawUrl);
                  try {
                    if (!tweetId) return { url: rawUrl };
                    const data = await getTweet(tweetId);
                    if (!data) return { url: canonicalLink(tweetId, rawUrl), id: tweetId };
                    const handle = data.user?.screen_name ?? undefined;
                    return {
                      url: handle
                        ? `https://x.com/${handle}/status/${tweetId}`
                        : canonicalLink(tweetId, rawUrl),
                      id: tweetId,
                      handle,
                      text: data.text,
                    };
                  } catch {
                    return { url: canonicalLink(tweetId, rawUrl), id: tweetId ?? undefined };
                  }
                }),
              )
            ).filter((p): p is XPost => p !== null);

            return { query, dateRange, posts };
          } catch (error) {
            return { query, dateRange, posts: [], error: String(error) };
          }
        }),
      );

      // Cross-query dedup by tweet ID or URL
      const seenKeys = new Set<string>();
      const deduped = results.map((r) => ({
        ...r,
        posts: r.posts.filter((p) => {
          const key = p.id ?? p.url;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        }),
      }));

      const allFailed = deduped.every((r) => r.posts.length === 0 && r.error);
      if (allFailed) {
        const errors = deduped.map((r) => r.error).filter(Boolean).join(" | ");
        throw new Error(`X search failed: ${errors}`);
      }

      return JSON.stringify(deduped, null, 2);
    },
  });
}
