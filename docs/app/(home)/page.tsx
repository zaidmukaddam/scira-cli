import { LandingHero } from '@/components/landing-hero';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Scira · terminal research & code agent',
  description:
    'A terminal agent that researches with cited sources and works in your codebase — every claim verified, every change gated by approval.',
  openGraph: {
    images: [{ url: '/cli-demo.png', width: 1400, height: 900, alt: 'Scira research session' }],
  },
};

export default function HomePage() {
  return <LandingHero />;
}
