# Scira docs site

[Fumadocs](https://fumadocs.dev) + Next.js documentation for `@scira/cli`.

## Develop

```bash
cd docs
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
cd docs
NODE_ENV=production bun run build
bun run start
```

## LLM exports

Fumadocs generates machine-readable docs for agents:

- `/llms.txt` — index
- `/llms-full.txt` — full content
- `/llms.mdx/docs/...` — per-page markdown

## Content

Edit MDX files in `content/docs/`. Navigation is controlled by `content/docs/meta.json`.
