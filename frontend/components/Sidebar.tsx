'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

const navItems = [
  {
    section: 'Overview',
    links: [
      { href: '/', label: 'Dashboard', icon: '📊' },
    ],
  },
  {
    section: 'Operations',
    links: [
      { href: '/deployments', label: 'Deployments', icon: '🚀' },
      { href: '/services', label: 'Services', icon: '⚙️' },
    ],
  },
  {
    section: 'Actions',
    links: [
      { href: '/services/new', label: 'Register Service', icon: '➕' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Image src="/logo.png" alt="Fortis-CI" width={36} height={36} />
        <div className="sidebar-logo-text">
          <h1>Fortis-CI</h1>
          <span>v1.0.0 · See Everything</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((section) => (
          <div key={section.section}>
            <div className="sidebar-section-label">{section.section}</div>
            {section.links.map((link) => {
              const isActive =
                link.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`sidebar-link ${isActive ? 'active' : ''}`}
                >
                  <span className="nav-icon">{link.icon}</span>
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        Fortis-CI © 2026 · Apache 2.0
      </div>
    </aside>
  );
}
