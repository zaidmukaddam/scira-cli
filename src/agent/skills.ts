export type Skill = {
  name: string;
  summary: string;
  content: string;
};

export const SKILLS: Skill[] = [
  {
    name: "research-plan",
    summary: "How to structure a research session into discovery, deep-dive, and synthesis phases",
    content: `# research-plan

## Standard research phases

### Phase 1 — Discovery (10-15 % of budget)
- Write plan.md with your research questions and initial approach.
- Run broad searches to map the landscape.
- Identify 8-12 candidate sources across quality tiers.
- Note key researchers, institutions, and technical terms for later queries.

### Phase 2 — Deep Dive (60-70 % of budget)
- Read the 5-8 most relevant sources.
- Call createClaim immediately after reading each source — don't batch at the end.
- Keep notes.md updated with key insights and emerging patterns.
- Discover additional sources through the references sections of sources you've read.

### Phase 3 — Synthesis (20-30 % of budget)
- Call verifyClaim for every recorded claim.
- Identify gaps: which key questions lack verified answers?
- Write report.md following the report-structure skill.
- Final sanity check: every statistic and specific claim in the report has a cited source ID.

## plan.md starter template
\`\`\`
# Research Plan: <topic>

## Goal
<one sentence>

## Research questions
1.
2.
3.

## Approach
Phase 1: <broad searches + source identification>
Phase 2: <deep reading + claim recording>
Phase 3: <verification + report synthesis>

## Status
[ ] Phase 1   [ ] Phase 2   [ ] Phase 3
\`\`\`
`
  },
  {
    name: "search-strategy",
    summary: "How to formulate effective search queries, iterate on failures, and exploit parallel fetch",
    content: `# search-strategy

## Core principle
Start broad, narrow by iteration. Never assume the first query is optimal.

## Use parallel queries (always)
webSearch accepts a \`queries\` array — always pass 3-5 variations for a single lookup.
This runs them in parallel and costs the same latency as one query.

Bad:  { queries: ["dolphin intelligence"] }
Good: { queries: ["dolphin intelligence research", "cetacean cognition studies 2023 2024",
                  "bottlenose dolphin problem solving experiments", "dolphin self-awareness evidence"] }

## Retry ladder when results are poor
1. Remove qualifiers (drop year, drop adjectives).
2. Swap synonyms: "intelligence" → "cognition" → "learning ability" → "executive function".
3. Add domain targeting: append "site:pubmed.ncbi.nlm.nih.gov" or "site:arxiv.org".
4. Search for the researcher or paper title fragment directly.

## Source discovery via chaining
- Wikipedia article "References" sections are free bibliographies — mine them.
- After finding a key paper, search for its author name to find related work.
- Search "<topic> systematic review" or "<topic> meta-analysis" for aggregated evidence.

## Know when to stop
If 3 different query formulations on the same subtopic return no useful results, record a
knowledge gap note in notes.md and move on rather than looping.
`
  },
  {
    name: "source-quality",
    summary: "Tiers for source credibility; how to assign claim confidence and spot red flags",
    content: `# source-quality

## Tier 1 — High confidence (confidence: "high")
- Peer-reviewed journals: PubMed / PMC, arXiv, Nature, Science, PLOS, Cell, PNAS
- Government databases: NIH, NOAA, NASA, CDC, WHO (.gov, .int)
- University research pages and institutional preprints (.edu)
Use confidence "high" when 2+ independent Tier 1 sources agree.

## Tier 2 — Medium confidence (confidence: "medium")
- Major news organizations with science desks (Reuters, BBC, NYT, AP)
- Wikipedia — use for orientation and bibliography mining, never as a citable source
- Reputable non-profits, professional associations
Use confidence "medium"; always seek corroboration for critical claims.

## Tier 3 — Low / Vendor (confidence: "low", status: "weak")
- Company blogs, product pages, PR releases, vendor whitepapers
- Social media, Reddit, forums, user-generated wikis
- Uncredited, undated, or anonymously authored content
Flag these explicitly as vendor/marketing in the report.

## Red flags
- "Studies show" or "research suggests" without a named citation.
- Statistics that only appear on a single vendor domain.
- Press releases that describe a study — always trace back to the original paper.
- Circular citations: A cites B which cites A — find the actual primary source.
`
  },
  {
    name: "claim-verification",
    summary: "Protocol for verifying claims: multi-source corroboration, status rules, and common traps",
    content: `# claim-verification

## Steps for each major claim
1. Identify the original source (journal, study name, institution, year).
2. Search with different terminology to find independent corroboration.
3. Actively search for contradicting evidence: "<claim topic> criticism",
   "<claim topic> limitations", "<claim topic> contradicted".

## Status decision table
| Evidence                                        | Status          |
|-------------------------------------------------|-----------------|
| 2+ independent Tier 1 sources agree             | verified        |
| Single Tier 1 source, no contradiction found    | needs_review    |
| Multiple sources disagree substantially         | contradicted    |
| Only vendor / marketing sources                 | weak            |
| No primary source found after 3 search attempts | weak            |

## Batching strategy
Record claims with createClaim as you read each source.
Run all verifyClaim calls together at the end of Phase 2, once the full evidence
picture is assembled — this avoids premature status assignment.

## Common traps
- Circular citations: trace back to the named primary study, not a news summary.
- Wikipedia summaries often chain to a single study — read the actual paper.
- "Preliminary study" and "pilot study" findings warrant confidence "low" regardless of source tier.
- Quantitative claims (percentages, effect sizes) need the exact study, not a secondary summary.
`
  },
  {
    name: "report-structure",
    summary: "Recommended section order, inline citation style, and prose rules for report.md",
    content: `# report-structure

## Section order

### Executive Summary (3-5 sentences)
Lead with the strongest conclusions. State what is definitively known and what remains uncertain.
Do not save the conclusion for the end.

### Key Findings
Bullet list. Each bullet has an inline source citation: [src_1] or [src_2, src_4].
Maximum one claim per bullet.

### Detailed Analysis
One subsection per major theme (200-300 words each).
Cite inline. Use "evidence suggests" or "appears to" for medium-confidence claims.
Use direct declarative statements only for verified claims.

### Methodology
Which searches were run, how many sources evaluated, which were excluded and why.
Name source tiers used.

### Open Questions / Limitations
Explicitly list what is NOT well-established.
Flag vendor-only evidence here.
This section adds credibility — do not omit it.

### References
One line per source:
  - [src_1] Title — https://url

## Style rules
- Findings: present tense ("dolphins demonstrate self-recognition…")
- Study descriptions: past tense ("Reiss & Marino (2001) found…")
- No invented statistics. If a number can't be traced to a primary source, omit it or flag it.
- Avoid hedge-stacking: "may possibly suggest" → "suggests"
- Bold key terms on first use.
- Aim for 800-1500 words for a standard run; longer only if the topic genuinely requires it.
`
  },
  {
    name: "browser-research",
    summary: "How to use Chrome DevTools MCP for research on rendered, interactive, JS-heavy, or runtime-dependent sources",
    content: `# browser-research

Use Chrome DevTools MCP as a research instrument when normal fetch/read tools cannot capture what a real user sees.

## When to use browser tools
- JS-heavy sites where readUrl returns empty, boilerplate, paywall shells, or missing article content.
- Product/pricing pages, dashboards, docs portals, app stores, maps, search pages, or sites with tabs/filters/infinite scroll.
- Claims about what a page currently shows: wording, feature availability, pricing tiers, UI flows, redirects, embedded data, dates, or generated content.
- Runtime evidence: network calls, API payloads, console errors, status codes, screenshots, layout/performance observations.
- Verification of screenshots or visual claims that cannot be proven from plain text.

## Research workflow
1. Start with webSearch to identify candidate URLs and readUrl for static pages.
2. Escalate a candidate URL to DevTools when the rendered page is the primary evidence or readUrl is incomplete.
3. Navigate to the URL, wait for content to settle, then capture a snapshot/text view before interacting.
4. If needed, click tabs, expand sections, apply filters, scroll, or inspect network calls.
5. Record a concise note in notes.md: URL, observation, action taken, and why browser evidence was needed.
6. Create claims from browser observations just like source text. Use the observed URL as the source and mention "browser-observed" in notes.

## Evidence quality
- Browser observations are primary evidence for "what the page showed at time of access."
- They are not independent corroboration. Cross-check important factual claims with separate sources.
- Prefer official pages for product/pricing/status claims, but flag vendor-only evidence as weak unless corroborated.
- For volatile pages, include access date/time in notes.md and report.md.

## Tool discipline
- State the exact hypothesis before using DevTools.
- Use the shortest reliable path: navigate, snapshot, maybe network/console/screenshot, then stop.
- Do not browse aimlessly. Every browser action should resolve a research question.
- Never enter secrets, private data, or credentials.
`
  },
  {
    name: "tool-efficiency",
    summary: "Tool batching patterns, retry tactics, file hygiene, and common anti-patterns to avoid",
    content: `# tool-efficiency

## webSearch
- Always pass 3-5 query variations in the queries array (parallel fetch, same latency as one).
- Use short noun phrases, not full sentences.
- Set retries: 2 for flaky searches.

## readUrl
- Target the specific article or paper page, not the site homepage.
- PubMed: use the /articles/PMC… URL for full text where available.
- If a URL 404s or times out, try: search for the title, or try an alternate domain.
- Do not re-read a URL you already read in this session.

## writeFile / bash
- Before writing, check what exists: bash \`cat filename 2>/dev/null | head -10\`
- Write complete files in one call; never partial appends to JSONL.
- sources.jsonl strict rules: one compact JSON per line, no literal newlines in strings,
  no trailing commas. Write the entire file at once using writeFile.

## createClaim / verifyClaim
- Call createClaim right after reading each source, not in a batch at the end.
- Use a consistent ID scheme: claim_001, claim_002, … or topic-prefixed: claim_cognition_001.
- Run all verifyClaim calls together after all claims are recorded.

## Narration discipline
- One line before each tool call: say what you're doing and why.
- Do not repeat a tool call that already succeeded in this session.
- Check notes.md with bash \`cat notes.md\` before re-researching a topic.

## Anti-patterns
- ✗ Searching the same query multiple times without changing terms.
- ✗ Reading a homepage hoping it contains the article text.
- ✗ Writing report.md before claims are verified.
- ✗ Omitting sources.jsonl or writing it with multiline string values.
`
  }
];

export const SKILL_NAMES = SKILLS.map(s => s.name);

/** Markdown bullet list of skill names + summaries, embedded directly in the agent system prompt. */
export const SKILL_CATALOG = SKILLS.map(s => `- ${s.name}: ${s.summary}`).join("\n");

export function getSkill(name: string): Skill | undefined {
  return SKILLS.find(s => s.name === name);
}
