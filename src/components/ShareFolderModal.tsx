'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Trash2, X, Folder, Mail, Globe, Loader2 } from 'lucide-react';

interface Share {
  id: string;
  shared_with: string;
  share_type: 'email' | 'domain';
  access_level: 'view' | 'edit';
  created_at: string;
}

interface ShareFolderModalProps {
  folderId: string;
  folderName: string;
  onClose: () => void;
}

export default function ShareFolderModal({ folderId, folderName, onClose }: ShareFolderModalProps) {
  const [email, setEmail] = useState('');
  const [accessLevel, setAccessLevel] = useState<'view' | 'edit'>('view');
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  const loadShares = useCallback(async () => {
    try {
      const res = await fetch(`/api/folders/share?folderId=${folderId}`);
      if (res.ok) {
        const data = await res.json();
        setShares(data);
      }
    } catch (err) {
      console.error('Error loading shares:', err);
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleShare = async () => {
    if (!email.trim()) {
      toast.error('Ingresa un correo o dominio');
      return;
    }
    setSharing(true);
    try {
      const res = await fetch('/api/folders/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, sharedWith: email.trim(), accessLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || data.error || 'Error al compartir');
        return;
      }
      setShares(prev => [{
        id: data.id,
        shared_with: data.sharedWith,
        share_type: data.shareType,
        access_level: data.accessLevel,
        created_at: new Date().toISOString(),
      }, ...prev.filter(s => s.id !== data.id)]);
      setEmail('');
      toast.success('Compartido');
    } catch (err) {
      toast.error('Error de red');
    } finally {
      setSharing(false);
    }
  };

  const handleDelete = async (shareId: string) => {
    try {
      const res = await fetch(`/api/folders/share?shareId=${shareId}`, { method: 'DELETE' });
      if (res.ok) {
        setShares(prev => prev.filter(s => s.id !== shareId));
        toast.success('Acceso revocado');
      } else {
        toast.error('Error al revocar');
      }
    } catch {
      toast.error('Error de red');
    }
  };

  return (
    <>
      <style>{`
        @keyframes shareModalFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes shareModalSlideIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'shareModalFadeIn 0.15s ease-out',
        }}
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1001, width: 'min(94vw, 520px)',
          background: 'var(--surface-1, #14141c)',
          border: '1px solid var(--border-light, rgba(255,255,255,0.08))',
          borderRadius: '12px',
          boxShadow: '0 20px 50px -10px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02)',
          maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          animation: 'shareModalSlideIn 0.18s ease-out',
          color: 'var(--foreground, #fff)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border-light, rgba(255,255,255,0.06))',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '8px',
              background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Folder size={18} style={{ color: '#a5b4fc' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.74rem', opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Compartir carpeta</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 600, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {folderName}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', padding: '6px', borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Invite section */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 500, marginBottom: '6px' }}>
              Invitar persona o dominio
            </label>
            <p style={{ fontSize: '0.76rem', opacity: 0.55, marginBottom: '10px' }}>
              Email individual (<code>user@empresa.com</code>) o dominio entero (<code>empresa.com</code>).
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@empresa.com o empresa.com"
                onKeyDown={(e) => e.key === 'Enter' && handleShare()}
                style={{
                  flex: 1, minWidth: 0,
                  padding: '9px 12px', borderRadius: '8px',
                  background: 'var(--surface-2, #1c1c28)',
                  border: '1px solid var(--border-light, rgba(255,255,255,0.08))',
                  color: '#fff', outline: 'none', fontSize: '0.88rem',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary, #6366f1)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-light, rgba(255,255,255,0.08))'; e.currentTarget.style.boxShadow = 'none'; }}
              />
              <select
                value={accessLevel}
                onChange={(e) => setAccessLevel(e.target.value as 'view' | 'edit')}
                style={{
                  padding: '9px 10px', borderRadius: '8px',
                  background: 'var(--surface-2, #1c1c28)',
                  border: '1px solid var(--border-light, rgba(255,255,255,0.08))',
                  color: '#fff', outline: 'none', fontSize: '0.86rem', cursor: 'pointer',
                }}
              >
                <option value="view">Ver</option>
                <option value="edit">Editar</option>
              </select>
              <button
                onClick={handleShare}
                disabled={sharing || !email.trim()}
                style={{
                  padding: '9px 16px', borderRadius: '8px',
                  background: sharing || !email.trim() ? 'rgba(99,102,241,0.4)' : 'var(--accent-primary, #6366f1)',
                  color: '#fff', border: 'none', cursor: sharing || !email.trim() ? 'not-allowed' : 'pointer',
                  fontSize: '0.88rem', fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: '6px',
                  transition: 'background 0.15s',
                }}
              >
                {sharing ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : null}
                {sharing ? 'Enviando' : 'Compartir'}
              </button>
            </div>
          </div>

          {/* Shares list */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 500 }}>Personas con acceso</label>
              <span style={{ fontSize: '0.72rem', opacity: 0.5 }}>{shares.length} {shares.length === 1 ? 'entrada' : 'entradas'}</span>
            </div>

            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', opacity: 0.5 }}>
                <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
              </div>
            ) : shares.length === 0 ? (
              <div style={{
                padding: '20px', textAlign: 'center',
                background: 'var(--surface-2, #1c1c28)', borderRadius: '8px',
                border: '1px dashed var(--border-light, rgba(255,255,255,0.08))',
                fontSize: '0.82rem', opacity: 0.55,
              }}>
                Aún no compartiste esta carpeta con nadie.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
                {shares.map((share) => (
                  <div
                    key={share.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 12px', borderRadius: '8px',
                      background: 'var(--surface-2, #1c1c28)',
                      border: '1px solid transparent',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-light, rgba(255,255,255,0.06))'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '999px',
                      background: share.share_type === 'domain' ? 'rgba(139,92,246,0.15)' : 'rgba(16,185,129,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {share.share_type === 'domain'
                        ? <Globe size={13} style={{ color: '#c4b5fd' }} />
                        : <Mail size={13} style={{ color: '#6ee7b7' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {share.shared_with}
                      </div>
                      <div style={{ fontSize: '0.72rem', opacity: 0.5, textTransform: 'capitalize' }}>
                        {share.share_type === 'domain' ? 'Dominio' : 'Email'} · {share.access_level === 'edit' ? 'Puede editar' : 'Solo ver'}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(share.id)}
                      aria-label="Revocar acceso"
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.4)', padding: '6px', borderRadius: '6px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#e06c75'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border-light, rgba(255,255,255,0.06))',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '0.74rem', opacity: 0.55,
        }}>
          <span>Los invitados recibirán acceso al loguearse</span>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface-2, #1c1c28)',
              border: '1px solid var(--border-light, rgba(255,255,255,0.08))',
              color: '#fff', padding: '6px 14px', borderRadius: '6px',
              fontSize: '0.82rem', cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3, #252533)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-2, #1c1c28)'; }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </>
  );
}
