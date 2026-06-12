'use client';

export function AskAI({ markdownUrl }: { markdownUrl: string }) {
  const open = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const abs = markdownUrl.startsWith('http') ? markdownUrl : `${origin}${markdownUrl}`;
    const q = `Read ${abs}, I want to ask questions about it.`;
    window.open(`https://scira.ai/?${new URLSearchParams({ q })}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      onClick={open}
      className="press inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium"
      style={{
        borderColor: 'var(--color-fd-border)',
        color: 'var(--color-fd-foreground)',
        background: 'var(--color-fd-card)',
      }}
      aria-label="Ask AI about this page"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-fd-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3z" />
        <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7L19 14z" />
      </svg>
      Ask AI
    </button>
  );
}
