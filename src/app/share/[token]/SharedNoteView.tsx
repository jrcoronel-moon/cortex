'use client';

import MarkdownEditor from '@/components/MarkdownEditor';
import { FileText, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface Props {
  node: { id: string; name: string; content: string; updatedAt: string };
}

export default function SharedNoteView({ node }: Props) {
  const title = node.name.replace('.md', '');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--border-light)', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <FileText size={18} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '0.75rem', opacity: 0.4 }}>
            Actualizado {new Date(node.updatedAt).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
          <Link
            href="/"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem', color: 'var(--accent-primary)', textDecoration: 'none', opacity: 0.8 }}
          >
            <ExternalLink size={13} /> Abrir Cortex
          </Link>
        </div>
      </header>

      {/* Content */}
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 24px' }}>
        <MarkdownEditor
          content={node.content || ''}
          onChange={() => {}}
          forceMode="preview"
        />
      </div>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '32px', borderTop: '1px solid var(--border-light)', fontSize: '0.75rem', opacity: 0.35 }}>
        Compartido con Cortex · Lectura solamente
      </footer>
    </div>
  );
}
