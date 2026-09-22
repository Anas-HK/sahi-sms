import type { Metadata, Viewport } from 'next';
import { Noto_Nastaliq_Urdu } from 'next/font/google';
import Analytics from '../components/Analytics';
import './globals.css';

const nastaliq = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--font-nastaliq',
});

export const metadata: Metadata = {
  title: 'Sahi SMS: 9771 petrol relief registration message',
  description:
    'Writes your 9771 petrol relief registration SMS so it does not fail. Free, and nothing you type or photograph leaves your phone.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f5c3f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={nastaliq.variable}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
