import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SciraConfig } from "../../types/index.js";
import { getRunPaths, summarizeRun, verificationReport } from "../../storage/run-store.js";
import { runResearchAgent } from "../../agent/main-agent.js";
import { readJsonl } from "../../storage/jsonl.js";
import { Claim, Source } from "../../types/index.js";

export async function openShell(runPath: string, config: SciraConfig): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    let active = true;
    while (active) {
      const state = await summarizeRun(runPath);
      const line = await rl.question(`scira ${state.id} sources:${state.sourceCount} report:${state.reportDirty ? "dirty" : "clean"} > `);
      const [command, ...args] = line.trim().split(/\s+/u);
      switch (command) {
        case "/help":
          console.log("/status /plan /run /sources /claims /why <claim-id> /verify /report /handoff /close");
          break;
        case "/status":
          console.log(await renderStatus(runPath));
          break;
        case "/plan":
          console.log(await Bun.file(getRunPaths(runPath).plan).text());
          break;
        case "/run":
          await runResearchAgent(runPath, state.goal, config);
          break;
        case "/sources":
          console.table(await readJsonl<Source>(getRunPaths(runPath).sources));
          break;
        case "/claims":
          console.table(await readJsonl<Claim>(getRunPaths(runPath).claims));
          break;
        case "/why":
          await explainClaim(runPath, args[0]);
          break;
        case "/verify":
          console.log(await verificationReport(runPath));
          break;
        case "/report":
          console.log(await Bun.file(getRunPaths(runPath).report).text().catch(() => "No report.md yet."));
          break;
        case "/handoff":
          console.log(await Bun.file(getRunPaths(runPath).handoff).text());
          break;
        case "/close":
        case "exit":
          active = false;
          break;
        case "":
          break;
        default:
          console.log("Unknown command. Run /help.");
      }
    }
  } finally {
    rl.close();
  }
}

async function renderStatus(runPath: string): Promise<string> {
  const state = await summarizeRun(runPath);
  return `Goal:\n  ${state.goal}\n\nProgress:\n  Sources collected: ${state.sourceCount}\n  Report status: ${state.reportDirty ? "dirty" : "clean"}\n\nNext:\n  /run to research, /report to view results`;
}

async function explainClaim(runPath: string, claimId?: string): Promise<void> {
  if (!claimId) {
    console.log("Usage: /why <claim-id>");
    return;
  }
  const claim = (await readJsonl<Claim>(getRunPaths(runPath).claims)).find((item) => item.id === claimId);
  if (!claim) {
    console.log(`Claim not found: ${claimId}`);
    return;
  }
  console.log(`${claim.text}\n\nSources: ${claim.sourceIds.join(", ") || "none"}\nConfidence: ${claim.confidence}\nStatus: ${claim.status}\nReason: ${claim.reason}`);
}
