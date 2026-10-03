import fs from 'fs';
import path from 'path';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export default function ChangelogPage() {
  let markdown = '';
  let loadError: string | null = null;

  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
    markdown = fs.readFileSync(changelogPath, 'utf-8');
  } catch (err: any) {
    loadError = err.message || 'Could not read CHANGELOG.md';
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', padding: '32px 24px 80px', color: 'var(--foreground)' }}>
      <main style={{ maxWidth: '780px', margin: '0 auto' }}>
        <header style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px',
          paddingBottom: '16px', marginBottom: '24px', borderBottom: '1px solid var(--border-light)',
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>
              📋 Cortex — Changelog
            </h1>
            <div style={{ fontSize: '0.78rem', opacity: 0.5, marginTop: '4px' }}>
              Current version: <strong>v{APP_VERSION}</strong>
            </div>
          </div>
          <Link href="/" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '13px' }}>
            ← Back to app
          </Link>
        </header>

        <div className="changelog-content">
          {loadError ? (
            <p style={{ color: '#ef4444' }}>Could not load changelog: {loadError}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h3: ({ children, ...props }) => {
                  const text = String(Array.isArray(children) ? children.join('') : children).trim().toLowerCase();
                  const kind = ['added', 'changed', 'fixed', 'removed'].includes(text) ? text : undefined;
                  return <h3 data-kind={kind} {...props}>{children}</h3>;
                },
              }}
            >
              {markdown}
            </ReactMarkdown>
          )}
        </div>

        <div style={{
          marginTop: '48px', paddingTop: '16px', borderTop: '1px solid var(--border-light)',
          fontSize: '12px', opacity: 0.55, textAlign: 'center',
        }}>
          Canonical source: <a href="https://github.com/jrcoronel-moon/cortex/blob/main/CHANGELOG.md" target="_blank" rel="noopener" style={{ color: 'var(--accent-primary)' }}>CHANGELOG.md</a> in the repo.
        </div>
      </main>
    </div>
  );
}
