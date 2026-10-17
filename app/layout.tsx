import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Caveat } from 'next/font/google';
import './globals.css';
import './exam.css';

// Headlines: a grotesque with some bite, so the page reads as a product for
// students rather than a school letter. Red ink: one handwriting face everywhere,
// so the grader's pen looks the same on every phone.
const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display', display: 'swap' });
const hand = Caveat({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-hand', display: 'swap' });

export const metadata: Metadata = {
  title: 'RedPen Maths: your calculus midterm, graded line by line',
  description: 'Try an exam-style calculus question with a trap. RedPen marks the exact line that lost the point, the way your TA grades, and teaches the fix. Join the list for a free marked practice exam.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US" className={`${display.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
