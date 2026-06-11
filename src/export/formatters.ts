import { type Source, type Claim } from "../types/index.js";

export type ExportBundle = {
  runId: string;
  goal: string;
  sources: Source[];
  claims: Claim[];
};

/** JSON export: structured object with all run data. */
export function toJson(bundle: ExportBundle): string {
  return JSON.stringify({
    runId: bundle.runId,
    goal: bundle.goal,
    exportedAt: new Date().toISOString(),
    sources: bundle.sources,
    claims: bundle.claims,
  }, null, 2);
}

/** Escape a CSV cell value per RFC 4180. */
function csvCell(value: string | undefined | null): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/gu, '""')}"`;
  }
  return s;
}

/** CSV export: sources section then claims section, separated by a blank line. */
export function toCsv(bundle: ExportBundle): string {
  const sections: string[] = [];

  if (bundle.sources.length > 0) {
    const header = ["id", "title", "url", "kind", "summary", "createdAt"].join(",");
    const rows = bundle.sources.map((s) =>
      [s.id, s.title, s.url, s.kind, s.summary, s.createdAt].map(csvCell).join(",")
    );
    sections.push([header, ...rows].join("\n"));
  }

  if (bundle.claims.length > 0) {
    const header = ["id", "text", "confidence", "status", "sourceIds", "reason", "createdAt"].join(",");
    const rows = bundle.claims.map((c) =>
      [c.id, c.text, c.confidence, c.status, c.sourceIds.join(";"), c.reason, c.createdAt]
        .map(csvCell).join(",")
    );
    sections.push([header, ...rows].join("\n"));
  }

  if (sections.length === 0) {
    return "# No sources or claims recorded for this run.\n";
  }
  return sections.join("\n\n");
}
