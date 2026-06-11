import { type SearchProvider } from "../../providers/llm/readiness.js";

export const USER_BAND_BG = "#1c1c1c";
export const S_BAR = "│";
export const MENU_VISIBLE = 8;
export const FILE_MENTION_MAX_CHARS = 20000;
export const FILE_MENTION_SKIP = new Set([".git", "node_modules", "dist", ".scira"]);
export const PROVIDERS: SearchProvider[] = ["parallel", "exa", "firecrawl"];

export const CHAT_COMMANDS = ["/help", "/new", "/rerun", "/report", "/sources", "/claims", "/why", "/mcp", "/copy", "/usage", "/rename", "/model", "/llm", "/provider", "/key", "/keys", "/stop", "/back", "/quit"];
export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  "/help": "Show command and keyboard shortcuts.",
  "/new": "Go to the home screen to start a new research run.",
  "/rerun": "Run the research agent again for this run.",
  "/report": "Show the generated report.md in the timeline.",
  "/sources": "List the run's gathered sources with links.",
  "/claims": "List all claims with id, confidence, status, and text.",
  "/why":    "Show full detail for a claim: /why <claim-id>",
  "/mcp":    "Manage MCP servers: /mcp list · /mcp enable/disable <name> · /mcp add <type> <name> <cmd|url>",
  "/copy": "Copy the last answer (or report) to the clipboard.",
  "/usage": "Show token usage per model for this session.",
  "/rename": "Set a title for this session, e.g. /rename SpaceX IPO analysis",
  "/model": "Open the model selector dropup.",
  "/llm": "Switch the LLM provider (gateway, xai, workers-ai).",
  "/provider": "Open the search provider selector.",
  "/key": "Save an API key, e.g. /key EXA_API_KEY ...",
  "/keys": "Show which required API keys are set.",
  "/stop": "Abort the currently running agent turn.",
  "/back": "Return to the sessions list.",
  "/quit": "Quit the TUI."
};

export const TOOL_ICONS: Record<string, string> = {
  bash: "$",
  writeFile: "✎",
  editFile: "✎",
  readFile: "▤",
  createClaim: "◎",
  verifyClaim: "✓",
  webSearch: "⌕",
  readUrl: "↗",
  listSkills: "★",
  readSkill: "★"
};

export const SPINNER_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"] as const;

export const HOME_TIPS = [
  "Type a question and press ⏎ to start a new research run.",
  "Say \"deep research …\" or \"compare …\" to trigger the full research harness.",
  "↑↓ navigate · ⏎ open · type to start a new run.",
  "/model · /provider · /key NAME value  to configure.",
  "Browse all sessions to find older runs.",
  "ready / draft badges show full-research runs and their report state."
] as const;

export const FULL_MODE_TRIGGERS = [
  "deep research", "deep dive", "deep-dive", "do research", "research about",
  "research on", "in depth", "in-depth", "comprehensive", "thorough",
  "detailed report", "full report", "write a report", "literature review",
  "investigate", "analyze", "analyse", "analysis of", "compare", "comparison",
  "pros and cons", "state of the art", "survey of", "everything about"
];
