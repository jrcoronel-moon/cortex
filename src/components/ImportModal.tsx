"use client";

import { useState } from 'react';
import toast from 'react-hot-toast';
import { X, FileText, Globe, FileDigit, Loader2, ArrowLeft, FileUp, FolderUp } from 'lucide-react';
import { DriveNode } from '@/lib/drive';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
  folders: { id: string; name: string }[];
  onCreated: (node: DriveNode) => void;
  /** Direct .md / folder upload (no conversion) — wired to the workspace's
      batch uploader, which preserves the folder structure. */
  onUploadMarkdown?: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
}

type Tab = 'markdown' | 'word' | 'web' | 'pdf';

export default function ImportModal({ open, onClose, workspaceId, folders, onCreated, onUploadMarkdown }: ImportModalProps) {
  const [tab, setTab] = useState<Tab>('markdown');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ title: string; markdown: string } | null>(null);
  const [destParent, setDestParent] = useState('');

  if (!open) return null;

  const reset = () => {
    setUrl(''); setFile(null); setResult(null); setConverting(false); setSaving(false); setDestParent('');
  };
  const close = () => { reset(); onClose(); };

  async function convert() {
    setConverting(true);
    try {
      let res: Response;
      if (tab === 'word' || tab === 'pdf') {
        if (!file) { toast.error(tab === 'pdf' ? 'Elige un archivo .pdf' : 'Elige un archivo .docx'); setConverting(false); return; }
        const fd = new FormData();
        fd.append('file', file);
        res = await fetch('/api/import/convert', { method: 'POST', body: fd });
      } else {
        if (!url.trim()) { toast.error('Pega una URL'); setConverting(false); return; }
        res = await fetch('/api/import/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        });
      }
      const data = await res.json();
      if (!res.ok) { toast.error(data.message || 'No se pudo convertir'); return; }
      if (!data.markdown?.trim()) { toast.error('No se encontró contenido convertible'); return; }
      setResult({ title: data.title || 'Sin título', markdown: data.markdown });
    } catch {
      toast.error('Error de red al convertir');
    } finally {
      setConverting(false);
    }
  }

  async function save() {
    if (!result) return;
    setSaving(true);
    try {
      const content = `---\ntitle: ${result.title}\n---\n\n${result.markdown}`;
      const res = await fetch('/api/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: result.title.replace(/[\/\n]/g, ' ').trim() || 'Importado',
          type: 'file',
          parentId: destParent || null,
          workspaceId: workspaceId || undefined,
          content,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Error al guardar');
        return;
      }
      onCreated(data as DriveNode);
      toast.success('Nota importada');
      close();
    } catch {
      toast.error('Error de red al guardar');
    } finally {
      setSaving(false);
    }
  }

  const tabBtn = (id: Tab, icon: React.ReactNode, label: string, disabled = false) => (
    <button
      onClick={() => !disabled && setTab(id)}
      disabled={disabled}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        padding: '12px 8px', borderRadius: '10px', cursor: disabled ? 'not-allowed' : 'pointer',
        border: `1px solid ${tab === id ? 'var(--accent-primary)' : 'var(--border-light)'}`,
        background: tab === id ? 'rgba(99,102,241,0.12)' : 'var(--surface-2)',
        color: 'var(--foreground)', opacity: disabled ? 0.45 : 1, fontSize: '0.82rem',
      }}
    >
      {icon}
      {label}
    </button>
  );

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
    display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '72px',
  };
  const card: React.CSSProperties = {
    width: '560px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
    background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '14px', padding: '20px',
  };
  const input: React.CSSProperties = {
    width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border-light)',
    color: 'var(--foreground)', padding: '10px 12px', borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box',
  };

  return (
    <div style={overlay} onClick={close}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <strong style={{ fontSize: '1.05rem' }}>Importar y convertir a Markdown</strong>
          <X size={18} onClick={close} style={{ cursor: 'pointer', opacity: 0.5 }} />
        </div>

        {!result ? (
          <>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
              {tabBtn('markdown', <FileUp size={20} />, 'Markdown')}
              {tabBtn('web', <Globe size={20} />, 'Página web')}
              {tabBtn('word', <FileText size={20} />, 'Word')}
              {tabBtn('pdf', <FileDigit size={20} />, 'PDF')}
            </div>

            {tab === 'markdown' && (
              <>
                <p style={{ fontSize: '0.82rem', opacity: 0.7, marginTop: 0 }}>
                  Sube archivos <strong>.md</strong> directamente — sin conversión. Al subir una carpeta se
                  <strong> conserva su estructura</strong> de subcarpetas.
                </p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <label style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '18px 8px', borderRadius: '10px', cursor: 'pointer', border: '1px dashed var(--border-light)', background: 'var(--surface-2)', color: 'var(--foreground)', fontSize: '0.82rem' }}>
                    <FileUp size={22} style={{ opacity: 0.8 }} />
                    Archivos .md
                    <input
                      type="file"
                      multiple
                      accept=".md,.markdown"
                      style={{ display: 'none' }}
                      onChange={async e => { await onUploadMarkdown?.(e); close(); }}
                    />
                  </label>
                  <label style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '18px 8px', borderRadius: '10px', cursor: 'pointer', border: '1px dashed var(--border-light)', background: 'var(--surface-2)', color: 'var(--foreground)', fontSize: '0.82rem' }}>
                    <FolderUp size={22} style={{ opacity: 0.8 }} />
                    Carpeta completa
                    {/* @ts-ignore — non-standard folder-picker attributes */}
                    <input type="file" webkitdirectory="" directory="" style={{ display: 'none' }} onChange={async e => { await onUploadMarkdown?.(e); close(); }} />
                  </label>
                </div>
              </>
            )}

            {tab === 'web' && (
              <>
                <label style={{ fontSize: '0.82rem', opacity: 0.7 }}>URL de la página</label>
                <input style={{ ...input, marginTop: '6px' }} placeholder="https://ejemplo.com/articulo"
                  value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') convert(); }} />
                <p style={{ fontSize: '0.75rem', opacity: 0.45, marginTop: '8px' }}>Extraemos el contenido principal del artículo y lo convertimos a Markdown.</p>
              </>
            )}

            {tab === 'word' && (
              <>
                <label style={{ fontSize: '0.82rem', opacity: 0.7 }}>Archivo Word (.docx)</label>
                <input type="file" accept=".docx" style={{ ...input, marginTop: '6px', padding: '8px' }}
                  onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <p style={{ fontSize: '0.75rem', opacity: 0.45, marginTop: '8px' }}>Solo .docx (el formato .doc antiguo no está soportado).</p>
              </>
            )}

            {tab === 'pdf' && (
              <>
                <label style={{ fontSize: '0.82rem', opacity: 0.7 }}>Archivo PDF</label>
                <input type="file" accept=".pdf" style={{ ...input, marginTop: '6px', padding: '8px' }}
                  onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <p style={{ fontSize: '0.75rem', opacity: 0.45, marginTop: '8px' }}>
                  Usa <strong>tu IA (BYOK)</strong> para reestructurar el PDF en Markdown. Requiere tener tu API key configurada en <strong>Ajustes → BYOK</strong>. PDFs escaneados (solo imagen) no se pueden convertir.
                </p>
              </>
            )}

            {tab !== 'markdown' && (
              <button className="btn btn-primary" disabled={converting}
                style={{ width: '100%', justifyContent: 'center', marginTop: '18px', opacity: converting ? 0.7 : 1 }}
                onClick={convert}>
                {converting ? <><Loader2 size={16} className="spin" /> {tab === 'pdf' ? 'Convirtiendo con IA…' : 'Convirtiendo…'}</> : 'Convertir'}
              </button>
            )}
          </>
        ) : (
          <>
            <button onClick={() => setResult(null)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: 'var(--foreground)', opacity: 0.6, cursor: 'pointer', fontSize: '0.8rem', marginBottom: '12px' }}>
              <ArrowLeft size={14} /> Volver
            </button>

            <label style={{ fontSize: '0.82rem', opacity: 0.7 }}>Título</label>
            <input style={{ ...input, marginTop: '6px', marginBottom: '12px' }} value={result.title}
              onChange={e => setResult({ ...result, title: e.target.value })} />

            {folders.length > 0 && (
              <>
                <label style={{ fontSize: '0.82rem', opacity: 0.7 }}>Guardar en</label>
                <select style={{ ...input, marginTop: '6px', marginBottom: '12px' }} value={destParent}
                  onChange={e => setDestParent(e.target.value)}>
                  <option value="">Raíz del espacio</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </>
            )}

            <label style={{ fontSize: '0.82rem', opacity: 0.7 }}>Vista previa (Markdown, editable)</label>
            <textarea style={{ ...input, marginTop: '6px', minHeight: '220px', maxHeight: '40vh', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.5, resize: 'vertical' }}
              value={result.markdown} onChange={e => setResult({ ...result, markdown: e.target.value })} />

            <button className="btn btn-primary" disabled={saving}
              style={{ width: '100%', justifyContent: 'center', marginTop: '16px', opacity: saving ? 0.7 : 1 }}
              onClick={save}>
              {saving ? 'Guardando…' : 'Guardar nota'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
