'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

export default function SetupGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    fetch(`${apiUrl}/api/setup/status`)
      .then(res => res.json())
      .then(data => {
        if (!data.configured && pathname !== '/setup') {
          router.push('/setup');
        } else {
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('SetupGuard error:', err);
        setLoading(false);
      });
  }, [pathname, router]);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Initializing Fortis-CI...
      </div>
    );
  }

  // If on the setup page, hide the standard app layout
  if (pathname === '/setup') {
    return <main style={{ width: '100%', minHeight: '100vh', background: 'var(--bg-color)' }}>{children}</main>;
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
