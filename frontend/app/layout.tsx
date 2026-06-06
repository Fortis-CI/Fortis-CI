import React from 'react';
import './globals.css';
import SetupGuard from '../components/SetupGuard';

export const metadata = {
  title: 'Fortis-CI — Deployment Intelligence',
  description: 'Neo4j-powered deployment observability, root cause analysis, and automated recovery',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SetupGuard>
          {children}
        </SetupGuard>
      </body>
    </html>
  );
}
