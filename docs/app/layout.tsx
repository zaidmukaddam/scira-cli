import { RootProvider } from 'fumadocs-ui/provider/next';
import { ThemeProvider } from 'next-themes';
import './global.css';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { GeistPixelSquare } from 'geist/font/pixel';
import type { Metadata } from 'next';
import { Newsreader } from 'next/font/google';

const sans = GeistSans;
const mono = GeistMono;
const pixel = GeistPixelSquare;

const display = Newsreader({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: 'Scira',
    template: '%s · Scira',
  },
  description:
    'Terminal-native AI research agent with grounded sources, verified claims, and local run storage.',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} ${pixel.variable}`}
      suppressHydrationWarning
    >
      <body className={`${sans.className} flex min-h-screen flex-col antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <RootProvider>{children}</RootProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
