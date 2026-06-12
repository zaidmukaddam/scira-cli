'use client';

import { useState } from 'react';

export function InstallChip({ command = 'bun i -g @scira/cli' }: { command?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <button
      onClick={copy}
      className="press group inline-flex h-11 items-center gap-3 rounded-full pl-4 pr-3 font-mono text-[13px]"
      style={{
        border: '1px solid var(--rule)',
        background: 'var(--card)',
        color: 'var(--ink-2)',
      }}
      aria-label="Copy install command"
    >
      <span style={{ color: 'var(--verify)' }}>❯</span>
      <span>{command}</span>
      <span
        className="ml-1 flex h-7 w-7 items-center justify-center rounded-full transition-colors"
        style={{ background: 'var(--paper-2)', color: copied ? 'var(--verify)' : 'var(--faint)' }}
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}
