'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function Consent() {
  const params = useSearchParams();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const clientName = params.get('client_name') || 'Una aplicación externa';

  useEffect(() => {
    fetch('/api/user')
      .then(r => {
        if (r.status === 401) {
          // Not logged in — send to login, then come back to this consent screen.
          const returnTo = window.location.pathname + window.location.search;
          window.location.href = '/login?returnTo=' + encodeURIComponent(returnTo);
          return null;
        }
        return r.json();
      })
      .then(d => { if (d) setEmail(d.email); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function decide(approve: boolean) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/oauth/authorize/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: params.get('client_id'),
          redirect_uri: params.get('redirect_uri'),
          code_challenge: params.get('code_challenge'),
          state: params.get('state'),
          approve,
        }),
      });
      const data = await res.json();
      if (data.redirect) { window.location.href = data.redirect; return; }
      setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  }

  const card: React.CSSProperties = {
    maxWidth: '460px', width: '100%', background: 'var(--surface-1)',
    border: '1px solid var(--border-light)', borderRadius: '14px', padding: '32px',
  };
  const btn: React.CSSProperties = {
    flex: 1, padding: '11px', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 600,
    cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1, border: 'none',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--background)', color: 'var(--foreground)', fontFamily: 'var(--font-sans)' }}>
      <div style={card}>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '6px' }}>🔗 Autorizar conexión</div>
        {loading ? (
          <p style={{ opacity: 0.6 }}>Cargando…</p>
        ) : (
          <>
            <p style={{ fontSize: '0.95rem', lineHeight: 1.6, marginTop: '14px' }}>
              <strong>{clientName}</strong> solicita conectarse a tu base de conocimiento de <strong>Cortex</strong>.
            </p>
            <p style={{ fontSize: '0.85rem', opacity: 0.7, lineHeight: 1.6, marginTop: '10px' }}>
              Podrá leer, buscar y crear notas <strong>en tu nombre</strong>, limitado únicamente a los espacios
              que ya puedes ver: tus workspaces, carpetas compartidas contigo y la base de conocimiento de tu organización.
            </p>
            {email && (
              <div style={{ fontSize: '0.82rem', opacity: 0.6, margin: '16px 0', padding: '10px 12px', background: 'var(--surface-2)', borderRadius: '8px' }}>
                Conectado como <strong>{email}</strong>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => decide(false)} disabled={submitting}
                style={{ ...btn, background: 'var(--surface-2)', color: 'var(--foreground)', border: '1px solid var(--border-light)' }}>
                Denegar
              </button>
              <button onClick={() => decide(true)} disabled={submitting}
                style={{ ...btn, background: 'var(--accent-primary)', color: '#fff' }}>
                {submitting ? 'Autorizando…' : 'Autorizar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={null}>
      <Consent />
    </Suspense>
  );
}
