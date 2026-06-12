'use client';

import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { gitConfig } from '@/lib/shared';

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-8 w-8" />;

  const dark = resolvedTheme === 'dark';

  return (
    <button
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="lnk flex h-8 w-8 items-center justify-center rounded-full"
    >
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

export function SiteHeader() {
  return (
    <header className="pointer-events-none fixed left-0 right-0 top-0 z-50 flex justify-center px-6 pt-5">
      <div
        className="pointer-events-auto flex h-11 items-center gap-1 rounded-full pl-4 pr-2"
        style={{
          background: 'var(--paper)',
          boxShadow: '0 0 0 1px var(--rule)',
        }}
      >
        <Link
          href="/"
          className="lnk px-1 font-mono text-[14px] font-semibold tracking-[-0.01em]"
        >
          scira cli
        </Link>

        <div className="mx-2 h-4 w-px" style={{ background: 'var(--rule)' }} />

        <nav className="flex items-center gap-0.5 text-[13px] font-medium">
          <Link href="/docs" className="lnk rounded-full px-3 py-1.5">Docs</Link>
          <a
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            className="lnk rounded-full px-3 py-1.5"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>

        <div className="mx-1 h-4 w-px" style={{ background: 'var(--rule)' }} />
        <ThemeToggle />
      </div>
    </header>
  );
}
