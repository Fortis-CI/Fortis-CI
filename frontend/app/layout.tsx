import React from 'react';
import './globals.css';
import Sidebar from '../components/Sidebar';

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
        <div className="app-layout">
          <Sidebar />
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
