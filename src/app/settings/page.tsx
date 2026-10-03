'use client';

import { useEffect, useState, ReactNode } from 'react';
import { Lock, Key, Trash2, Eye, EyeOff, ArrowLeft, CheckCircle, Building2, Plus, Zap, Copy, Check, Activity } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { APP_VERSION } from '@/lib/version';

type Provider = 'openai' | 'anthropic';
type SettingsTab = 'workspaces' | 'mcp' | 'apikeys' | 'status' | 'byok';

// Selectable models per provider for the AI assistant (BYOK).
const MODELS: Record<Provider, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — más capaz' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — equilibrado' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — rápido y económico' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini — económico' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  ],
};
const DEFAULT_MODEL: Record<Provider, string> = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o-mini' };

interface ApiKey {
  id: string;
  name: string;
  workspace_id: string;
  exposed_folders?: string;
  created_at: string;
  last_used_at?: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('workspaces');
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL.anthropic);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string; role?: string }[]>([]);
  const [newWsName, setNewWsName] = useState('');
  const [creatingWs, setCreatingWs] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [storedProvider, setStoredProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [workspaceFolders, setWorkspaceFolders] = useState<{ id: string; name: string }[]>([]);
  const [oauthApps, setOauthApps] = useState<any[]>([]);
  const [newOAuthAppName, setNewOAuthAppName] = useState('');
  const [newOAuthClientType, setNewOAuthClientType] = useState<'claude_code' | 'claude_web' | 'chatgpt' | 'custom'>('claude_code');
  const [newOAuthCustomRedirectUri, setNewOAuthCustomRedirectUri] = useState('');
  const [newOAuthAppFolders, setNewOAuthAppFolders] = useState<Set<string>>(new Set());
  const [creatingOAuthApp, setCreatingOAuthApp] = useState(false);
  const [revealedOAuthSecret, setRevealedOAuthSecret] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [copiedOAuthSecretId, setCopiedOAuthSecretId] = useState<string | null>(null);
  const [editingAppFolders, setEditingAppFolders] = useState<string | null>(null);
  const [editingFolders, setEditingFolders] = useState<Set<string>>(new Set());
  const [mcpStatus, setMcpStatus] = useState<any>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [selectedFolderWorkspace, setSelectedFolderWorkspace] = useState<string | null>(null);

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyWorkspaceId, setNewKeyWorkspaceId] = useState<string>('');
  const [newKeyFolders, setNewKeyFolders] = useState<Set<string>>(new Set());
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: string; key: string } | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const loadApiKeys = async () => {
    const res = await fetch('/api/keys');
    if (res.ok) {
      const keys = await res.json();
      setApiKeys(keys);
    }
  };

  const handleCreateApiKey = async () => {
    if (!newKeyName.trim()) { toast.error('Ingresa un nombre'); return; }
    if (!newKeyWorkspaceId) { toast.error('Selecciona un workspace'); return; }
    setCreatingKey(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          workspaceId: newKeyWorkspaceId,
          exposedFolders: Array.from(newKeyFolders),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error'); return; }
      setRevealedKey({ id: data.id, key: data.key });
      setApiKeys(prev => [data, ...prev]);
      setNewKeyName('');
      setNewKeyFolders(new Set());
      toast.success('API key creada');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    if (!confirm('¿Eliminar esta API key? Las aplicaciones que la usen dejarán de funcionar.')) return;
    const res = await fetch(`/api/keys?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setApiKeys(prev => prev.filter(k => k.id !== id));
      toast.success('API key eliminada');
    }
  };

  const loadOAuthApps = async () => {
    const res = await fetch('/api/oauth/applications');
    if (res.ok) {
      const apps = await res.json();
      setOauthApps(apps);
    }
  };

  const handleCreateOAuthApp = async () => {
    if (!newOAuthAppName.trim()) {
      toast.error('Ingresa un nombre para la aplicación');
      return;
    }

    if (newOAuthClientType === 'custom' && !newOAuthCustomRedirectUri.trim()) {
      toast.error('Ingresa una URI de redirección para cliente custom');
      return;
    }

    setCreatingOAuthApp(true);
    const res = await fetch('/api/oauth/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newOAuthAppName.trim(),
        clientType: newOAuthClientType,
        customRedirectUri: newOAuthCustomRedirectUri.trim() || undefined,
        exposedFolders: Array.from(newOAuthAppFolders),
      }),
    });
    setCreatingOAuthApp(false);

    if (res.ok) {
      const app = await res.json();
      setOauthApps(prev => [...prev, app]);
      setRevealedOAuthSecret({ clientId: app.clientId, clientSecret: app.clientSecret });
      setNewOAuthAppName('');
      setNewOAuthClientType('claude_code');
      setNewOAuthCustomRedirectUri('');
      setNewOAuthAppFolders(new Set());
      toast.success('Aplicación MCP creada. ¡Copia el secret ahora!');
    } else {
      const err = await res.json();
      toast.error(err.error || 'Error al crear aplicación');
    }
  };

  const handleUpdateAppFolders = async (appId: string) => {
    const res = await fetch('/api/oauth/applications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId: appId,
        exposedFolders: Array.from(editingFolders),
      }),
    });

    if (res.ok) {
      setOauthApps(prev => prev.map(app =>
        app.id === appId ? { ...app, exposedFolders: Array.from(editingFolders) } : app
      ));
      setEditingAppFolders(null);
      setEditingFolders(new Set());
      toast.success('Carpetas actualizadas');
    } else {
      toast.error('Error al actualizar carpetas');
    }
  };

  const handleDeleteOAuthApp = async (appId: string) => {
    if (!confirm('¿Eliminar esta aplicación OAuth? Cualquier cliente conectado dejará de funcionar.')) return;
    const res = await fetch(`/api/oauth/applications?id=${appId}`, { method: 'DELETE' });
    if (res.ok) {
      setOauthApps(prev => prev.filter(a => a.id !== appId));
      if (revealedOAuthSecret?.clientId === appId) setRevealedOAuthSecret(null);
      toast.success('Aplicación OAuth eliminada');
    } else {
      toast.error('Error al eliminar');
    }
  };

  const copyOAuthSecret = (text: string, appId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedOAuthSecretId(appId);
    setTimeout(() => setCopiedOAuthSecretId(null), 2000);
  };

  const loadWorkspaceFolders = async (workspaceId: string) => {
    try {
      console.log('Loading folders for workspace:', workspaceId);
      const res = await fetch(`/api/node?workspaceId=${workspaceId}`);
      if (res.ok) {
        const nodes = await res.json();
        console.log('Nodes received:', nodes);
        const folders = nodes.filter((n: any) => n.type === 'folder').map((n: any) => ({ id: n.id, name: n.name }));
        console.log('Filtered folders:', folders);
        setWorkspaceFolders(folders);
      } else {
        const err = await res.json();
        console.error('Error loading folders:', res.status, err);
        setWorkspaceFolders([]);
      }
    } catch (err) {
      console.error('Error loading folders:', err);
      setWorkspaceFolders([]);
    }
  };

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        setHasStoredKey(d.hasKey);
        setStoredProvider(d.byokProvider);
        if (d.byokProvider) setProvider(d.byokProvider as Provider);
        if (d.byokModel) setSelectedModel(d.byokModel);
      })
      .finally(() => setLoading(false));

    fetch('/api/workspace')
      .then(r => r.json())
      .then(async d => {
        setWorkspaces(d);
        if (d.length > 0) {
          setSelectedFolderWorkspace(d[0].id);
          await loadWorkspaceFolders(d[0].id);
        }
      })
      .catch(err => console.error('Workspace fetch error:', err));

    fetch('/api/user').then(r => r.json()).then(d => { if (d.role) setUserRole(d.role); }).catch(() => {});
    loadOAuthApps();
    loadApiKeys();
  }, []);

  useEffect(() => {
    if (selectedFolderWorkspace) {
      loadWorkspaceFolders(selectedFolderWorkspace);
    }
  }, [selectedFolderWorkspace]);

  useEffect(() => {
    if (activeTab === 'status') {
      setMcpLoading(true);
      fetch('/api/mcp/health')
        .then(r => r.json())
        .then(d => setMcpStatus(d))
        .catch(err => console.error('MCP status fetch error:', err))
        .finally(() => setMcpLoading(false));
    }
  }, [activeTab]);

  const handleCreateWorkspace = async () => {
    if (!newWsName.trim()) return;
    setCreatingWs(true);
    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newWsName.trim() }),
    });
    setCreatingWs(false);
    if (res.ok) {
      const ws = await res.json();
      setWorkspaces(prev => [...prev, ws]);
      setNewWsName('');
      toast.success('Workspace creado');
    } else {
      const err = await res.json();
      toast.error('Error al crear workspace');
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm('¿Eliminar este workspace? Se perderán todas sus notas.')) return;
    const res = await fetch(`/api/workspace?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setWorkspaces(prev => prev.filter(w => w.id !== id));
      toast.success('Workspace eliminado');
    } else {
      toast.error('Error al eliminar');
    }
  };

  const handleSave = async () => {
    // A key is required only the first time; afterwards you can change provider/model
    // without re-entering it.
    if (!apiKey.trim() && !hasStoredKey) { toast.error('Ingresa una API key'); return; }
    setSaving(true);
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model: selectedModel, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
    });
    setSaving(false);
    if (res.ok) {
      setHasStoredKey(true);
      setStoredProvider(provider);
      setApiKey('');
      toast.success(apiKey.trim() ? 'API key guardada con encriptación AES-256' : 'Configuración actualizada');
    } else {
      toast.error('Error al guardar');
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Eliminar tu API key guardada?')) return;
    await fetch('/api/settings', { method: 'DELETE' });
    setHasStoredKey(false);
    setStoredProvider(null);
    toast.success('API key eliminada');
  };


  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)', fontFamily: 'var(--font-sans)' }}>

      <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '48px 32px' }}>
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', opacity: 0.6, marginBottom: '32px', color: 'var(--foreground)', textDecoration: 'none' }}>
          <ArrowLeft size={14} /> Volver al workspace
        </Link>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '24px' }}>Configuración</h1>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '32px', borderBottom: '1px solid var(--border-light)', paddingBottom: '12px' }}>
          {(['workspaces', 'mcp', 'apikeys', 'status', 'byok'] as const)
            // MCP Applications tab is restricted to the superadmin.
            .filter(tab => tab !== 'mcp' || userRole === 'admin')
            .map(tab => {
            const labels: Record<SettingsTab, string> = {
              workspaces: 'Workspaces',
              mcp: 'MCP Web',
              apikeys: 'Claude Code',
              status: 'Status',
              byok: 'BYOK',
            };
            const icons: Record<SettingsTab, ReactNode> = {
              workspaces: <Building2 size={16} />,
              mcp: <Lock size={16} />,
              apikeys: <Key size={16} />,
              status: <Activity size={16} />,
              byok: <Key size={16} />,
            };
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: isActive ? 'var(--accent-primary)' : 'var(--foreground)',
                  opacity: isActive ? 1 : 0.6,
                  fontSize: '0.9rem',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  borderBottom: isActive ? '2px solid var(--accent-primary)' : 'none',
                  transition: 'all 0.2s ease',
                }}
              >
                {icons[tab]}
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Workspaces Section */}
        {activeTab === 'workspaces' && (
        <section style={{ background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Building2 size={18} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Workspaces</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {workspaces.map(w => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: '8px' }}>
                <span style={{ fontSize: '0.9rem' }}>{w.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '0.75rem', opacity: 0.45 }}>{w.role ?? 'owner'}</span>
                  {(w.role === 'owner' || !w.role) && workspaces.length > 1 && (
                    <button onClick={() => handleDeleteWorkspace(w.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#e06c75', display: 'flex' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={newWsName}
              onChange={e => setNewWsName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateWorkspace(); }}
              placeholder="Nombre del nuevo workspace"
              style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', padding: '8px 12px', borderRadius: '6px', fontSize: '0.9rem' }}
            />
            <button onClick={handleCreateWorkspace} disabled={creatingWs}
              style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: creatingWs ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', opacity: creatingWs ? 0.7 : 1 }}>
              <Plus size={16} /> Crear
            </button>
          </div>
        </section>
        )}

        {/* MCP Applications Section */}
        {activeTab === 'mcp' && userRole === 'admin' && (
        <section style={{ background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Lock size={18} style={{ color: '#7d59b4' }} />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>MCP Web</h2>
          </div>
          <p style={{ fontSize: '0.75rem', opacity: 0.5, marginBottom: '16px' }}>
            Conecta desde Claude.ai (u otro cliente web MCP) con solo pegar la URL y autorizar con tu cuenta.
            El registro es automático (OAuth + PKCE); no necesitas crear nada a mano.
          </p>

          {/* Existing Applications */}
          {oauthApps.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px', opacity: 0.7 }}>Conexiones activas</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {oauthApps.map(app => (
                  <div key={app.id} style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{app.name}</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.45, marginTop: '2px', fontFamily: 'monospace' }}>
                          {app.clientId}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteOAuthApp(app.id)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#e06c75', display: 'flex', padding: '4px' }}
                        title="Eliminar aplicación"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '4px' }}>Cliente: <span style={{ textTransform: 'capitalize' }}>{app.clientType?.replace('_', ' ') || 'custom'}</span></div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '6px' }}>URI de Redirección:</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.45, fontFamily: 'monospace', marginBottom: '8px', wordBreak: 'break-all' }}>
                      {app.redirectUri}
                    </div>

                    {editingAppFolders === app.id ? (
                      <div style={{ padding: '10px', background: 'var(--surface-1)', borderRadius: '6px', marginTop: '8px' }}>
                        <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px', fontWeight: 600 }}>Editar carpetas expuestas:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto', marginBottom: '8px' }}>
                          {workspaceFolders.map(folder => (
                            <label key={folder.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editingFolders.has(folder.id)}
                                onChange={e => {
                                  const newFolders = new Set(editingFolders);
                                  if (e.target.checked) {
                                    newFolders.add(folder.id);
                                  } else {
                                    newFolders.delete(folder.id);
                                  }
                                  setEditingFolders(newFolders);
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                              {folder.name}
                            </label>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            onClick={() => handleUpdateAppFolders(app.id)}
                            style={{ flex: 1, background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                          >
                            Guardar
                          </button>
                          <button
                            onClick={() => { setEditingAppFolders(null); setEditingFolders(new Set()); }}
                            style={{ flex: 1, background: 'var(--surface-1)', border: '1px solid var(--border-light)', color: 'var(--foreground)', borderRadius: '6px', padding: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingAppFolders(app.id);
                          setEditingFolders(new Set(app.exposedFolders || []));
                        }}
                        style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0', textDecoration: 'underline' }}
                      >
                        Editar carpetas ({(app.exposedFolders || []).length > 0 ? `${app.exposedFolders.length} seleccionadas` : 'todas'})
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MCP Server URL */}
          <div style={{ background: 'rgba(125,89,180,0.1)', border: '1px solid rgba(125,89,180,0.2)', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '4px' }}>URL del conector — pégala en Claude.ai → Settings → Connectors → Add custom connector:</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="text"
                value={`${typeof window !== 'undefined' ? window.location.origin : 'https://tu-dominio'}/api/mcp/web`}
                readOnly
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', padding: '8px 12px', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'monospace', boxSizing: 'border-box' }}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/api/mcp/web`);
                  toast.success('Copiado');
                }}
                style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Copy size={14} />
              </button>
            </div>
          </div>

          {/* How it works */}
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '10px', opacity: 0.7 }}>Cómo conectar</div>
            <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '0.82rem', opacity: 0.7, lineHeight: 1.7 }}>
              <li>Copia la URL del conector de arriba.</li>
              <li>En Claude.ai: <strong>Settings → Connectors → Add custom connector</strong> y pégala.</li>
              <li>Claude abrirá una ventana; <strong>inicia sesión con tu cuenta</strong> y autoriza.</li>
              <li>El conector accede a tus notas <strong>como tú</strong>: solo lo que ya puedes ver (tus workspaces, carpetas compartidas y la base de conocimiento de tu organización).</li>
            </ol>
            <p style={{ fontSize: '0.75rem', opacity: 0.45, marginTop: '10px' }}>
              Para revocar el acceso de un cliente, elimínalo desde “Conexiones activas”.
            </p>
          </div>
        </section>
        )}

        {/* API Keys Section */}
        {activeTab === 'apikeys' && (
        <section style={{ background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <Key size={18} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Claude Code</h2>
          </div>
          <p style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: '20px' }}>
            Para clientes MCP que usan autenticación por header (Claude Code, Cursor, Continue, etc.).
            Usa: <code style={{ background: 'var(--surface-2)', padding: '2px 6px', borderRadius: '4px' }}>Authorization: Bearer &lt;tu_key&gt;</code>
          </p>

          {/* Existing keys */}
          {apiKeys.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '10px', opacity: 0.85 }}>Keys existentes</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {apiKeys.map(k => {
                  const wsName = workspaces.find(w => w.id === k.workspace_id)?.name || k.workspace_id;
                  const folders = k.exposed_folders ? JSON.parse(k.exposed_folders) : [];
                  return (
                    <div key={k.id} style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{k.name}</div>
                        <div style={{ fontSize: '0.74rem', opacity: 0.6, marginTop: '2px' }}>
                          Workspace: {wsName} · {folders.length > 0 ? `${folders.length} carpeta(s)` : 'todas las carpetas'}
                          {k.last_used_at && ` · Último uso: ${new Date(k.last_used_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteApiKey(k.id)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#e06c75', padding: '6px' }}
                        title="Eliminar"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Revealed key (show once) */}
          {revealedKey && (
            <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid #10b981', borderRadius: '8px', padding: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <CheckCircle size={16} style={{ color: '#10b981' }} />
                <strong style={{ fontSize: '0.88rem' }}>Copia tu API key ahora — no se mostrará de nuevo</strong>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  readOnly
                  value={revealedKey.key}
                  style={{ flex: 1, padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: '6px', color: '#fff', fontFamily: 'monospace', fontSize: '0.82rem' }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(revealedKey.key);
                    setCopiedKeyId(revealedKey.id);
                    setTimeout(() => setCopiedKeyId(null), 2000);
                  }}
                  style={{ background: 'var(--accent-primary)', border: 'none', color: '#fff', padding: '0 14px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {copiedKeyId === revealedKey.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  onClick={() => setRevealedKey(null)}
                  style={{ background: 'transparent', border: '1px solid var(--border-light)', color: '#fff', padding: '0 12px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  OK
                </button>
              </div>
            </div>
          )}

          {/* Create new key */}
          <div style={{ background: 'var(--surface-2)', padding: '16px', borderRadius: '8px' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px' }}>Crear nueva API key</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', opacity: 0.7, display: 'block', marginBottom: '4px' }}>Nombre</label>
                <input
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  placeholder="Ej: Claude Code, Cursor, etc."
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '6px', color: '#fff', fontSize: '0.88rem' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', opacity: 0.7, display: 'block', marginBottom: '4px' }}>Workspace</label>
                <select
                  value={newKeyWorkspaceId}
                  onChange={e => { setNewKeyWorkspaceId(e.target.value); setNewKeyFolders(new Set()); }}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '6px', color: '#fff', fontSize: '0.88rem' }}
                >
                  <option value="">Selecciona un workspace</option>
                  {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              {newKeyWorkspaceId && workspaceFolders.length > 0 && (
                <div>
                  <label style={{ fontSize: '0.78rem', opacity: 0.7, display: 'block', marginBottom: '6px' }}>
                    Carpetas a exponer (vacío = todas)
                  </label>
                  <div style={{ background: 'var(--surface-1)', padding: '8px', borderRadius: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                    {workspaceFolders.map(f => (
                      <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={newKeyFolders.has(f.id)}
                          onChange={e => {
                            const next = new Set(newKeyFolders);
                            if (e.target.checked) next.add(f.id); else next.delete(f.id);
                            setNewKeyFolders(next);
                          }}
                        />
                        {f.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={handleCreateApiKey}
                disabled={creatingKey || !newKeyName.trim() || !newKeyWorkspaceId}
                className="btn btn-primary"
                style={{ justifyContent: 'center', padding: '10px' }}
              >
                <Plus size={14} /> {creatingKey ? 'Creando...' : 'Crear API key'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: '20px', padding: '12px', background: 'var(--surface-2)', borderRadius: '6px', fontSize: '0.78rem', opacity: 0.75 }}>
            <strong style={{ display: 'block', marginBottom: '6px' }}>Uso con Claude Code:</strong>
            <code style={{ background: 'var(--surface-1)', padding: '8px', borderRadius: '4px', display: 'block', fontFamily: 'monospace', fontSize: '0.78rem', overflowX: 'auto' }}>
              claude mcp add --transport http cortex https://cortex.example.com/api/mcp \<br/>
              &nbsp;&nbsp;--header &quot;Authorization: Bearer tu_api_key&quot;
            </code>
          </div>
        </section>
        )}

        {/* Status Section */}
        {activeTab === 'status' && (
        <section style={{ background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Activity size={18} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Estado del MCP Server</h2>
          </div>

          {mcpLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--foreground)', opacity: 0.6 }}>
              <div style={{ fontSize: '0.9rem', marginBottom: '12px' }}>Cargando estado del servidor...</div>
            </div>
          ) : mcpStatus ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Health Status */}
              <div style={{ padding: '14px', background: 'var(--surface-2)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: mcpStatus.status === 'ok' ? '#10b981' : '#ef4444', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Estado: {mcpStatus.status?.toUpperCase()}</span>
                </div>
              </div>

              {/* Server Info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '2px' }}>Servidor</div>
                  <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>{mcpStatus.name}</div>
                </div>
                <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '2px' }}>Versión</div>
                  <div style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>{mcpStatus.version}</div>
                </div>
              </div>

              {/* Capabilities */}
              {mcpStatus.capabilities && (
                <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '10px', opacity: 0.8 }}>Capacidades</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {Object.entries(mcpStatus.capabilities).map(([key, value]) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: '6px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: value ? '#10b981' : '#6b7280', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.85rem', flex: 1, textTransform: 'capitalize' }}>{key}</span>
                        <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{value ? 'Habilitado' : 'Deshabilitado'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tools */}
              {mcpStatus.tools && mcpStatus.tools.length > 0 && (
                <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '10px', opacity: 0.8 }}>Herramientas Disponibles ({mcpStatus.tools.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                    {mcpStatus.tools.map((tool: any, idx: number) => (
                      <div key={idx} style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: '6px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px', color: 'var(--accent-primary)' }}>{tool.name}</div>
                        {tool.description && (
                          <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '6px' }}>{tool.description}</div>
                        )}
                        {tool.inputSchema && (
                          <div style={{ fontSize: '0.7rem', opacity: 0.5, fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', padding: '6px 8px', borderRadius: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                            {typeof tool.inputSchema === 'object' ? JSON.stringify(tool.inputSchema, null, 2) : tool.inputSchema}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw Status JSON */}
              <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
                <details style={{ cursor: 'pointer' }}>
                  <summary style={{ fontSize: '0.75rem', opacity: 0.6, userSelect: 'none' }}>Ver JSON completo</summary>
                  <pre style={{ marginTop: '8px', padding: '12px', background: 'var(--surface-2)', borderRadius: '6px', fontSize: '0.7rem', overflow: 'auto', maxHeight: '200px', fontFamily: 'monospace', color: 'var(--foreground)' }}>
                    {JSON.stringify(mcpStatus, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--foreground)', opacity: 0.6 }}>
              <div style={{ fontSize: '0.9rem' }}>No se pudo cargar el estado del servidor</div>
            </div>
          )}
        </section>
        )}

        {/* BYOK Section */}
        {activeTab === 'byok' && (
        <section style={{ background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '24px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Key size={18} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Bring Your Own Key (BYOK)</h2>
          </div>

          {hasStoredKey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(125,89,180,0.1)', border: '1px solid rgba(125,89,180,0.3)', borderRadius: '8px', marginBottom: '20px' }}>
              <CheckCircle size={15} style={{ color: '#7d59b4', flexShrink: 0 }} />
              <span style={{ fontSize: '0.85rem', flex: 1 }}>
                Key de <strong>{storedProvider}</strong> guardada con encriptación AES-256-GCM
              </span>
              <button onClick={handleDelete} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#e06c75', display: 'flex' }}>
                <Trash2 size={15} />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', opacity: 0.6, marginBottom: '6px' }}>Proveedor</label>
              <select
                value={provider}
                onChange={e => {
                  const p = e.target.value as Provider;
                  setProvider(p);
                  setSelectedModel(DEFAULT_MODEL[p]);
                }}
                style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', padding: '9px 12px', borderRadius: '6px', fontSize: '0.9rem' }}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', opacity: 0.6, marginBottom: '6px' }}>Modelo</label>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', padding: '9px 12px', borderRadius: '6px', fontSize: '0.9rem' }}
              >
                {MODELS[provider].map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <p style={{ fontSize: '0.75rem', opacity: 0.45, marginTop: '6px' }}>
                El asistente IA usará este modelo con tu API key.
              </p>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', opacity: 0.6, marginBottom: '6px' }}>
                {hasStoredKey ? 'Nueva API key (reemplaza la actual)' : 'API key'}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={provider === 'anthropic' ? 'sk-ant-api03-...' : 'sk-...'}
                  style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', padding: '9px 40px 9px 12px', borderRadius: '6px', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
                <button
                  onClick={() => setShowKey(v => !v)}
                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--foreground)', opacity: 0.5, display: 'flex' }}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p style={{ fontSize: '0.75rem', opacity: 0.45, marginTop: '6px' }}>
                Tu key nunca se envía a servidores de Cortex. Se encripta localmente con AES-256-GCM.
              </p>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || loading}
              style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '0.9rem', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Guardando...' : hasStoredKey ? 'Actualizar key' : 'Guardar key'}
            </button>
          </div>
        </section>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '8px' }}>
          <Link
            href="/changelog"
            target="_blank"
            rel="noopener"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '4px 10px', borderRadius: '999px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-light)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '0.74rem', fontWeight: 500,
              textDecoration: 'none', letterSpacing: '0.02em',
              transition: 'background 0.15s, color 0.15s',
            }}
            title="View changelog"
          >
            v{APP_VERSION}
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ opacity: 0.55 }}>Changelog</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
