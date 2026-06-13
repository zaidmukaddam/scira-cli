import { type SearchProvider } from "../../providers/llm/readiness.js";

export const S_BAR = "│";
export const MENU_VISIBLE = 8;
export const FILE_MENTION_MAX_CHARS = 20000;
export const FILE_MENTION_SKIP = new Set([".git", "node_modules", "dist", ".scira"]);
export const PROVIDERS: SearchProvider[] = ["parallel", "exa", "firecrawl"];

export const CHAT_COMMANDS = ["/help", "/home", "/new", "/plan", "/rerun", "/report", "/sources", "/claims", "/why", "/mcp", "/copy", "/usage", "/rename", "/model", "/llm", "/provider", "/thinking", "/reasoning", "/theme", "/links", "/key", "/keys", "/stop", "/back", "/quit"];

/** Commands grouped by purpose, for the /help reference. */
export const COMMAND_GROUPS: { label: string; commands: string[] }[] = [
  { label: "Model", commands: ["/llm", "/model", "/provider", "/plan", "/thinking", "/reasoning"] },
  { label: "Session", commands: ["/new", "/rerun", "/rename", "/report", "/sources", "/claims", "/why", "/copy", "/usage"] },
  { label: "Setup", commands: ["/key", "/keys", "/mcp", "/theme", "/links"] },
  { label: "Go", commands: ["/home", "/back", "/stop", "/quit"] },
];

/** Keyboard shortcuts shown in /help (not discoverable via the `/` autocomplete). */
export const KEY_HINTS: { keys: string; action: string }[] = [
  { keys: "↑↓ jk u/d pgup/dn", action: "scroll" },
  { keys: "^C ^C / ^D", action: "quit" },
  { keys: "esc", action: "clear input / close" },
  { keys: "/ @ #", action: "commands · files · sessions" },
  { keys: "[ ] C", action: "navigate / toggle tool groups" },
];

/** Slash commands that take an argument; ⏎ from the menu appends a space instead of running. */
export const COMMANDS_NEEDING_ARGS = new Set(["/theme", "/key", "/rename", "/why", "/links"]);
export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  "/help": "Show command and keyboard shortcuts.",
  "/home": "Go to the home screen (or show the welcome card on home).",
  "/new": "Go to the home screen to start a new session.",
  "/plan": "Toggle plan mode (explore and plan before making changes).",
  "/rerun": "Run the research agent again for this session.",
  "/report": "Show the generated report.md in the timeline.",
  "/sources": "List the run's gathered sources with links.",
  "/claims": "List all claims with id, confidence, status, and text.",
  "/why":    "Show full detail for a claim: /why <claim-id>",
  "/mcp":    "Manage MCP servers: /mcp list · /mcp enable/disable <name> · /mcp add <type> <name> <cmd|url>",
  "/copy": "Copy the last answer (or report) to the clipboard.",
  "/usage": "Show token usage per model for this session.",
  "/rename": "Set a title for this session, e.g. /rename SpaceX IPO analysis",
  "/model": "Open the model selector dropup.",
  "/llm": "Switch the LLM provider (gateway, xai, workers-ai, claude-code, codex).",
  "/provider": "Open the search provider selector.",
  "/thinking": "Claude Code thinking: /thinking off · on · adaptive",
  "/reasoning": "Codex reasoning effort: /reasoning low · medium · high",
  "/theme": "Set UI theme: /theme dark · /theme light · /theme auto",
  "/links": "Link opens: /links always · /links ask",
  "/key": "Save an API key, e.g. /key EXA_API_KEY ...",
  "/keys": "Show API key status and where to get missing keys.",
  "/stop": "Abort the currently running agent turn.",
  "/back": "Return to the sessions list.",
  "/quit": "Quit the TUI."
};

export const TOOL_ICONS: Record<string, string> = {
  bash: "$",
  runBash: "$",
  writeFile: "✎",
  editFile: "✎",
  readFile: "▤",
  createClaim: "◎",
  verifyClaim: "✓",
  webSearch: "⌕",
  multiWebSearch: "⌕",
  fileChange: "✎",
  readUrl: "↗",
  listSkills: "★",
  readSkill: "★",
  todo: "☐",
  readWorkspaceFile: "▤",
  writeWorkspaceFile: "✎",
  editWorkspaceFile: "✎",
  listWorkspaceDir: "▤",
  grepWorkspace: "⌕"
};

export const SPINNER_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"] as const;

export const LOADING_PHRASES = [
  "Thinking it through…",
  "Digging into it…",
  "Connecting the dots…",
  "Gathering context…",
  "Working through it…",
  "Sifting the details…",
  "Putting it together…",
  "Chasing down answers…",
  "Mulling it over…",
  "Lining things up…",
  "Reading the room…",
  "Scanning the sources…",
  "Cross-checking facts…",
  "Tracing the threads…",
  "Weighing the options…",
  "Following the trail…",
  "Piecing it together…",
  "Untangling the details…",
  "Skimming the fine print…",
  "Joining the dots…",
  "Hunting for specifics…",
  "Sorting signal from noise…",
  "Drafting the answer…",
  "Double-checking the work…",
  "Wrapping my head around it…",
] as const;

export const HOME_TIPS = [
  "Type a question and press ⏎ to start a new session.",
  "Say \"deep research …\" or \"compare …\" to trigger the full research harness.",
  "↑↓ navigate · ⏎ open · type to start a new session.",
  "/model · /provider · /key NAME value  to configure.",
  "Browse all sessions to find older ones.",
  "ready / draft badges show full-research runs and their report state."
] as const;

export const FULL_MODE_TRIGGERS = [
  "deep research", "deep dive", "deep-dive", "do research", "research about",
  "research on", "in depth", "in-depth", "comprehensive", "thorough",
  "detailed report", "full report", "write a report", "literature review",
  "investigate", "analyze", "analyse", "analysis of", "compare", "comparison",
  "pros and cons", "state of the art", "survey of", "everything about"
];
