import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import React from 'react';
import './globals.css';
import Providers from '@/components/Providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'STAYPOOL - Token-Backed Survival Game',
  description: 'A survival-based crypto game where participants must stay alert to win the prize pool.',
  keywords: ['crypto', 'game', 'solana', 'survival', 'defi', 'token'],
  authors: [{ name: 'STAYPOOL Team' }],
  viewport: 'width=device-width, initial-scale=1',
  themeColor: '#0369a1',
  openGraph: {
    title: 'STAYPOOL - Token-Backed Survival Game',
    description: 'Stay alert, stay alive, win the pool! The ultimate crypto survival game.',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'STAYPOOL Game',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'STAYPOOL - Token-Backed Survival Game',
    description: 'Stay alert, stay alive, win the pool!',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body className={inter.className}>
        <Providers>
          <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
            <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]"></div>
            <div className="relative z-10">
              {children}
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
} 