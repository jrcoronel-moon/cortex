"use client";

import { useState, useEffect } from 'react';
import { Mail, CheckCircle, Zap } from 'lucide-react';

const IS_DEV = process.env.NODE_ENV !== 'production';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);
  const [returnTo, setReturnTo] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const rt = params.get('returnTo');
      if (rt && rt.startsWith('/')) setReturnTo(rt);
    }
  }, []);

  const handleDevLogin = async () => {
    setDevLoading(true);
    try {
      const res = await fetch('/api/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) window.location.href = returnTo || '/';
    } finally {
      setDevLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, returnTo })
      });
      if (res.ok) {
        setSent(true);
      } else {
        const errorData = await res.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const googleHref = returnTo ? `/api/auth/google/login?returnTo=${encodeURIComponent(returnTo)}` : '/api/auth/google/login';

  return (
    <div className="flex-center h-screen w-full relative" style={{ background: 'var(--background)' }}>
      {/* Decorative gradient background */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
        zIndex: 0, borderRadius: '50%'
      }}></div>

      <div className="glass-panel animate-fade-in" style={{ padding: '40px', width: '100%', maxWidth: '400px', zIndex: 1, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.8rem', marginBottom: '8px', fontWeight: 600 }}>Welcome to Cortex</h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '32px', fontSize: '0.9rem' }}>
          Enter your email to receive a magic link.
        </p>

        {IS_DEV && (
          <>
            <button
              onClick={handleDevLogin}
              disabled={devLoading}
              style={{
                width: '100%', padding: '12px', borderRadius: '8px',
                border: '1px solid rgba(99,102,241,0.5)',
                background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                marginBottom: '20px',
              }}
            >
              <Zap size={16} />
              {devLoading ? 'Entrando...' : 'Dev Login — Entrar como admin'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>o con email</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
            </div>
          </>
        )}

        {sent ? (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <CheckCircle size={48} color="#6366f1" />
            <p>Check your email for the login link!</p>
          </div>
        ) : (
          <>
            <a
              href={googleHref}
              style={{
                width: '100%', padding: '12px', borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: '#fff', color: '#1f1f1f',
                cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                marginBottom: '20px', textDecoration: 'none',
                boxSizing: 'border-box',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continuar con Google
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>o con magic link</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
            </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', top: '50%', left: '12px', transform: 'translateY(-50%)', opacity: 0.5 }} />
              <input 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" 
                required
                style={{
                  width: '100%', padding: '12px 12px 12px 40px', borderRadius: '8px',
                  background: 'var(--surface-1)', border: '1px solid var(--border-light)',
                  color: 'white', outline: 'none', fontSize: '1rem'
                }}
              />
            </div>
            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ justifyContent: 'center', padding: '12px' }}
              disabled={loading}
            >
              {loading ? 'Sending...' : 'Send Magic Link'}
            </button>
          </form>
          </>
        )}
      </div>
    </div>
  );
}
