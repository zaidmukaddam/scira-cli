import type React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { gitConfig, appVersion } from '@/lib/shared';
import { InstallChip } from '@/components/install-chip';

const REPO = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;


const features = [
  {
    n: '01',
    title: 'Grounded research',
    body: 'Scira searches Exa, Parallel, or Firecrawl and reads the pages before it writes a word. Every claim carries a citation you can open. No source, no claim.',
  },
  {
    n: '02',
    title: 'Works in your code',
    body: 'It reads files, makes edits, greps the repo, and runs commands, and it asks first. Manual, suggest, or auto approval, so nothing touches your shell without a yes.',
  },
  {
    n: '03',
    title: 'Yours, on disk',
    body: 'plan.md, sources.jsonl, claims.jsonl, report.md. Every run is plain files under .scira/runs/. Nothing is uploaded. Resume, re-run, verify, and export any time.',
  },
];

const stages = [
  ['01', 'Plan', 'plan.md', 'Scira breaks your question into sub-questions and a search plan you can read or edit before anything runs.'],
  ['02', 'Gather', 'sources.jsonl', 'webSearch finds pages; readUrl pulls each one in full. Raw extracts are saved so a citation can always be re-checked.'],
  ['03', 'Verify', 'claims.jsonl', 'Each factual statement is tied to a source URL and a status. Claims without backing never reach the report.'],
  ['04', 'Report', 'report.md', 'A written report where every sentence traces to a page you can open. Export to Markdown or JSON, or keep going in the TUI.'],
] as const;

export function LandingHero() {
  return (
    <div className="doc flex flex-1 flex-col overflow-x-clip">
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative mx-auto w-full max-w-[1100px] px-6 pt-36 text-center md:pt-44">
        <div className="rise mx-auto max-w-3xl">
          <span
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-pixel text-[11px] tracking-[0.04em]"
            style={{ border: '1px solid var(--rule)', color: 'var(--muted)' }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--verify)' }} />
            terminal research &amp; code agent
          </span>

          <h1
            className="font-serif-d mx-auto mt-7 max-w-3xl text-balance text-[3.1rem] font-normal leading-[1.04] tracking-[-0.02em] md:text-[4.6rem]"
            style={{ color: 'var(--ink)' }}
          >
            Research you can <span style={{ color: 'var(--verify)' }}>verify.</span>
            <br className="hidden sm:block" /> Code you can{' '}
            <span style={{ color: 'var(--verify)' }}>trust.</span>
          </h1>

          <p
            className="mx-auto mt-6 max-w-[500px] text-pretty text-[17.5px] leading-[1.65]"
            style={{ color: 'var(--muted)' }}
          >
            Two jobs, one terminal. Scira researches the web with cited sources and works in your
            codebase, saving every run as plain files you own.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs/installation"
              className="press inline-flex h-11 items-center rounded-full px-6 text-[14px] font-medium hover:opacity-85"
              style={{ background: 'var(--ink)', color: 'var(--paper)' }}
            >
              Get started
            </Link>
            <InstallChip />
          </div>
        </div>

        {/* terminal centerpiece */}
        <div className="relative mx-auto mt-16 max-w-[1000px]">
          <div className="glow-warm" />
          <div
            className="relative overflow-hidden"
            style={{
              borderRadius: '14px',
              border: '1px solid var(--rule)',
              boxShadow: 'var(--shadow)',
            }}
          >
            <Image
              src="/cli-demo.png"
              alt="Scira research session — web search, tool traces, and cited sources"
              width={1800}
              height={1125}
              priority
              className="h-auto w-full select-none"
              sizes="(max-width: 1024px) 100vw, 1000px"
            />
          </div>
        </div>
      </section>

      {/* ── Providers ─────────────────────────────────────────────── */}
      <section className="mx-auto mt-20 w-full max-w-[1100px] px-6 md:mt-24">
        <p className="text-center font-mono text-[11px] tracking-[0.14em] uppercase" style={{ color: 'var(--faint)' }}>
          Bring your own model and search
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-7 gap-y-5">
          {([
            ['Exa', <img src="/exa-color.svg" alt="" className="h-5 w-auto" />],
            ['Parallel', <img src="/parallel-icon.svg" alt="" className="h-5 w-auto dark:invert" />],
            ['Firecrawl', <><img src="/firecrawl-light.svg" alt="" className="h-5 w-auto dark:hidden" /><img src="/firecrawl-dark.svg" alt="" className="hidden h-5 w-auto dark:block" /></>],
            ['AI Gateway', <><img src="/vercel-light.svg" alt="" className="h-5 w-auto dark:hidden" /><img src="/vercel-dark.svg" alt="" className="hidden h-5 w-auto dark:block" /></>],
            ['xAI', <><img src="/xai-light.svg" alt="" className="h-5 w-auto dark:hidden" /><img src="/xai-dark.svg" alt="" className="hidden h-5 w-auto dark:block" /></>],
            ['Cloudflare', <img src="/cloudflare.svg" alt="" className="h-5 w-auto" />],
            ['Hugging Face', <img src="/huggingface.svg" alt="" className="h-5 w-auto" />],
          ] as [string, React.ReactNode][]).map(([name, logo]) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div className="flex h-5 items-center justify-center">{logo}</div>
              <span className="font-mono text-[10px] tracking-[0.05em]" style={{ color: 'var(--muted)' }}>{name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features (flat columns, no cards) ─────────────────────── */}
      <section className="mx-auto mt-24 w-full max-w-[1100px] px-6 md:mt-32">
        <div className="grid md:grid-cols-3">
          {features.map((f) => (
            <div key={f.n} className="feat-col px-0 py-8 md:px-8 md:py-2">
              <span className="font-mono text-[12px]" style={{ color: 'var(--verify)' }}>
                {f.n}
              </span>
              <h3
                className="font-serif-d mt-3 text-[1.5rem] leading-tight"
                style={{ color: 'var(--ink)' }}
              >
                {f.title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-[1.7]" style={{ color: 'var(--muted)' }}>
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────── */}
      <section className="mx-auto mt-28 w-full max-w-[1100px] px-6 md:mt-36">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            className="font-serif-d text-balance text-[2.2rem] font-normal leading-[1.1] tracking-[-0.015em] md:text-[2.8rem]"
            style={{ color: 'var(--ink)' }}
          >
            Nothing it does is hidden from you.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[16px] leading-[1.65]" style={{ color: 'var(--muted)' }}>
            A research run moves through four stages, and each one writes a plain file the moment it
            happens.
          </p>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden md:grid-cols-4" style={{ background: 'var(--rule)', borderRadius: '14px', border: '1px solid var(--rule)' }}>
          {stages.map(([n, title, file, body]) => (
            <div key={n} className="px-6 py-7" style={{ background: 'var(--bg)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px]" style={{ color: 'var(--verify)' }}>
                  {n}
                </span>
                <code className="font-mono text-[11px]" style={{ color: 'var(--faint)' }}>
                  {file}
                </code>
              </div>
              <h3 className="font-serif-d mt-4 text-[1.3rem]" style={{ color: 'var(--ink)' }}>
                {title}
              </h3>
              <p className="mt-2.5 text-[13.5px] leading-[1.65]" style={{ color: 'var(--muted)' }}>
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── TUI showcase ─────────────────────────────────────────── */}
      <section className="mx-auto mt-28 w-full max-w-[1100px] px-6 md:mt-36">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className="max-w-md">
            <span className="font-mono text-[11px] tracking-[0.14em] uppercase" style={{ color: 'var(--verify)' }}>
              The TUI
            </span>
            <h2
              className="font-serif-d mt-4 text-balance text-[2rem] font-normal leading-[1.12] tracking-[-0.015em] md:text-[2.5rem]"
              style={{ color: 'var(--ink)' }}
            >
              Configure once. Return anytime.
            </h2>
            <p className="mt-4 text-[16px] leading-[1.7]" style={{ color: 'var(--muted)' }}>
              Pick a model and search provider from the home screen, then stay in the terminal. Every
              control is a slash command away.
            </p>

            <div className="mt-7 space-y-2.5 font-mono text-[13px]">
              {[
                ['/model', 'switch the active model'],
                ['/provider', 'switch search provider'],
                ['/sources', 'list gathered sources'],
                ['/report', 'open report.md'],
              ].map(([cmd, desc]) => (
                <div key={cmd} className="flex items-center gap-3">
                  <span className="font-pixel" style={{ color: 'var(--verify)', minWidth: '92px' }}>{cmd}</span>
                  <span style={{ color: 'var(--faint)' }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            className="overflow-hidden"
            style={{ borderRadius: '14px', border: '1px solid var(--rule)', boxShadow: 'var(--shadow)' }}
          >
            <Image
              src="/scira-cli.png"
              alt="Scira home screen with model and search provider selection"
              width={1200}
              height={720}
              className="h-auto w-full select-none"
              sizes="(max-width: 768px) 100vw, 540px"
            />
          </div>
        </div>
      </section>

      {/* ── Closing ──────────────────────────────────────────────── */}
      <section className="mx-auto mt-28 w-full max-w-[1100px] px-6 py-28 text-center md:mt-36 md:py-36">
        <h2
          className="font-serif-d mx-auto max-w-2xl text-balance text-[2.5rem] font-normal leading-[1.08] tracking-[-0.02em] md:text-[3.4rem]"
          style={{ color: 'var(--ink)' }}
        >
          Stop hoping your answers are true.{' '}
          <span style={{ color: 'var(--verify)' }}>Verify them.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-sm text-[16px] leading-[1.65]" style={{ color: 'var(--muted)' }}>
          MIT licensed. Runs locally. Your data never leaves your machine.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/installation"
            className="press inline-flex h-11 items-center rounded-full px-6 text-[14px] font-medium hover:opacity-85"
            style={{ background: 'var(--ink)', color: 'var(--paper)' }}
          >
            Get started
          </Link>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="press lnk inline-flex h-11 items-center rounded-full px-6 text-[14px] font-medium"
            style={{ border: '1px solid var(--rule)' }}
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="px-6 pb-10" style={{ borderTop: '1px solid var(--rule)' }}>
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-4 pt-8 text-[13px]">
          <p className="font-mono" style={{ color: 'var(--faint)' }}>
            scira v{appVersion} · MIT
          </p>
          <nav className="flex items-center gap-6">
            <Link href="/docs" className="lnk">Docs</Link>
            <Link href="/docs/contributing" className="lnk">Contributing</Link>
            <a href={REPO} target="_blank" rel="noreferrer" className="lnk">GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
