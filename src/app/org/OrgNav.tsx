"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function OrgNav({ canManage }: { canManage: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: '/org/people', label: 'People' },
    ...(canManage ? [{ href: '/org/settings', label: 'Settings' }] : []),
  ];

  return (
    <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid var(--border-light)' }}>
      {tabs.map(tab => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              padding: '10px 16px',
              fontSize: '0.88rem',
              textDecoration: 'none',
              color: active ? 'var(--foreground)' : 'rgba(255,255,255,0.6)',
              borderBottom: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
              fontWeight: active ? 600 : 500,
              marginBottom: '-1px',
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
