import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Initialize SQLite database
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'cortex.db');
const db = new Database(dbPath, { timeout: 5000 });
db.pragma('journal_mode = WAL');

// Create tables if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user',
    is_banned BOOLEAN DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_groups (
    user_id TEXT,
    group_id TEXT,
    access_level TEXT DEFAULT 'view',
    PRIMARY KEY (user_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS group_spaces (
    group_id TEXT,
    space_id TEXT,
    PRIMARY KEY (group_id, space_id)
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'folder' or 'file'
    parent_id TEXT,
    content TEXT,
    group_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'viewer',
    invited_by TEXT,
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    byok_provider TEXT,
    byok_key_enc TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS embeddings (
    node_id TEXT PRIMARY KEY,
    vector TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS oauth_applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    client_id TEXT NOT NULL UNIQUE,
    client_secret_hash TEXT NOT NULL,
    client_type TEXT DEFAULT 'custom',
    redirect_uri TEXT NOT NULL,
    exposed_folders TEXT DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS oauth_tokens (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL UNIQUE,
    refresh_token TEXT,
    expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS folder_shares (
    id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    shared_by TEXT NOT NULL,
    shared_with TEXT NOT NULL,
    share_type TEXT NOT NULL,
    access_level TEXT DEFAULT 'view',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT UNIQUE NOT NULL,
    owner_id TEXT NOT NULL,
    is_personal INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS organization_members (
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (org_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS org_invitations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    invited_by TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    accepted_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

`);

const WELCOME_CONTENT = `# Welcome to Cortex 🚀

**Context infrastructure for AI agents.** Your unified workspace for knowledge management, designed for teams that need to share what their AI tools should know.

---

## ✨ Workspace Features

- **Tabbed editor** — multitask with multiple notes open at once.
- **Markdown + frontmatter** — YAML metadata (title, tags, aliases), WikiLinks (\`[[reference]]\`), syntax highlighting.
- **Knowledge Graph** — force-directed view of how your notes connect.
- **Semantic search** — find notes by meaning, not just keywords (powered by local embeddings).
- **AI Assistant** — chat with your knowledge base using your own API key (BYOK).
- **Import & drag-and-drop** — bring entire folders of markdown files preserving structure, and reorganize by dragging notes and folders.

## 🏢 Organizations & Sharing

- **Auto-claim domain** — the first user from your corporate domain becomes the org owner. Teammates join automatically.
- **Members & guests** — invite people by email (\`People\` tab in your org). Members belong to the organization; guests only reach the folders you share with them.
- **Folder sharing** — share an individual folder with a specific email or an entire domain. Hover any root folder to see the share icon.
- **Roles** — owner / admin / member, with view or edit access on shared folders.

## 🔌 Connect your AI (MCP)

Expose your notes to Claude, ChatGPT, Cursor, Continue, or any MCP-compatible client. The agent reads and writes **as you** — limited to the spaces you can already access (your workspaces, shared folders and your organization's knowledge base).

- **MCP Web (Claude.ai & other web clients)** — copy your connector URL from *Settings → MCP Web*, paste it in Claude.ai, then **log in and authorize** on an explicit consent screen. OAuth 2.1 + PKCE with automatic client registration — nothing to set up by hand.
- **Claude Code / Cursor / Continue** — header-auth with an API key from *Settings → Claude Code*.
- **Tools available**: list spaces, list / search / get / create / update notes.
- Per-connection **folder restrictions** so the AI only sees what you choose.

## 🧭 Getting Started

1. **Create a folder** with the \`+\` icon in the ribbon on the left.
2. **Write your first note** inside — markdown, frontmatter, WikiLinks all supported.
3. **Invite a teammate** from *Organization → People*.
4. **Connect your AI** — *Settings → MCP Web* for Claude.ai, or *Settings → Claude Code* for the CLI.

Use the left **Ribbon** to navigate: files, search, favorites, AI assistant, shared folders, organization, and settings.

Happy building. 🪐
`;

const WELCOME_CONTENT_ES = `# Bienvenido a Cortex 🚀

**Infraestructura de contexto para agentes de IA.** Tu espacio unificado de gestión del conocimiento, pensado para equipos que necesitan compartir lo que sus herramientas de IA deben saber.

---

## ✨ Funciones del workspace

- **Editor por pestañas** — trabaja con varias notas abiertas a la vez.
- **Markdown + frontmatter** — metadatos YAML (título, tags, alias), WikiLinks (\`[[referencia]]\`), resaltado de sintaxis.
- **Grafo de conocimiento** — vista de fuerzas de cómo se conectan tus notas.
- **Búsqueda semántica** — encuentra notas por significado, no solo por palabras clave (embeddings locales).
- **Asistente de IA** — chatea con tu base de conocimiento usando tu propia API key (BYOK).
- **Importar y arrastrar** — trae carpetas enteras de markdown conservando la estructura, y reorganiza arrastrando notas y carpetas.

## 🏢 Organizaciones y compartir

- **Auto-reclamo de dominio** — el primer usuario de tu dominio corporativo se convierte en dueño de la organización. Los compañeros se unen automáticamente.
- **Miembros e invitados** — invita por email (pestaña \`People\` de tu organización). Los miembros pertenecen a la organización; los invitados solo acceden a las carpetas que compartas con ellos.
- **Compartir carpetas** — comparte una carpeta con un email específico o con todo un dominio. Pasa el cursor sobre una carpeta raíz para ver el icono de compartir.
- **Roles** — owner / admin / member, con acceso de lectura o edición en las carpetas compartidas.

## 🔌 Conecta tu IA (MCP)

Expón tus notas a Claude, ChatGPT, Cursor, Continue o cualquier cliente compatible con MCP. El agente lee y escribe **en tu nombre** — limitado a los espacios que ya puedes ver (tus workspaces, carpetas compartidas y la base de conocimiento de tu organización).

- **MCP Web (Claude.ai y otros clientes web)** — copia la URL del conector desde *Ajustes → MCP Web*, pégala en Claude.ai y luego **inicia sesión y autoriza** en una pantalla de consentimiento explícita. OAuth 2.1 + PKCE con registro automático de cliente — nada que configurar a mano.
- **Claude Code / Cursor / Continue** — autenticación por header con una API key desde *Ajustes → Claude Code*.
- **Herramientas disponibles**: listar espacios, listar / buscar / obtener / crear / actualizar notas.
- **Restricción por carpetas** por conexión, para que la IA solo vea lo que elijas.

## 🧭 Primeros pasos

1. **Crea una carpeta** con el icono \`+\` de la barra izquierda.
2. **Escribe tu primera nota** dentro — markdown, frontmatter y WikiLinks soportados.
3. **Invita a un compañero** desde *Organización → People*.
4. **Conecta tu IA** — *Ajustes → MCP Web* para Claude.ai, o *Ajustes → Claude Code* para la CLI.

Usa la **barra** izquierda para navegar: archivos, búsqueda, favoritos, asistente de IA, carpetas compartidas, organización y ajustes.

Feliz construcción. 🪐
`;

// Showcase note: every markdown feature the viewer supports, in one document.
// Seeded once (INSERT OR IGNORE, no boot refresh) so user edits — e.g. to the
// editable draw.io diagram — are never overwritten.
const EJEMPLOS_CONTENT = `---
title: Ejemplos de formato
tags: [demo, markdown, ayuda]
aliases: [Guía de formato, Cheatsheet]
autor: Cortex
---

# 🧪 Ejemplos de formato

Esta nota muestra **todo lo que puedes usar** en un documento de Cortex. Pulsa el lápiz (✏️, arriba a la derecha) para ver el código fuente de cada ejemplo.

---

## ✍️ Texto y emojis

Texto en **negrita**, en *cursiva*, en ***negrita cursiva***, ~~tachado~~ y \`código en línea\`.

Los emojis funcionan directamente: 🚀 🔥 ✅ ⚠️ 💡 🧠 📌

> Las citas se ven así — útiles para resaltar ideas.
> — Y admiten **formato** dentro.

## 📋 Listas

- Viñetas simples
- Con sub-niveles:
  - Anidada uno
  - Anidada dos

1. Listas numeradas
2. Segundo paso
3. Tercer paso

Listas de tareas:

- [x] Tarea completada
- [ ] Tarea pendiente
- [ ] Otra pendiente

## 📊 Tablas

| Función | Estado | Notas |
| :--- | :---: | ---: |
| Tablas GFM | ✅ | alineación por columna |
| Emojis | ✅ | 🎉 |
| Código | ✅ | resaltado de sintaxis |

## 🔗 Enlaces

- Enlace externo: [cortex.example.com](https://github.com/jrcoronel-moon/cortex)
- WikiLink a otra nota: [[Welcome]]
- WikiLink con alias: [[Bienvenido|la nota de bienvenida]]
- Nota al pie[^1]

[^1]: Esto es una nota al pie (GFM). Aparece al final del documento.

## 🖼️ Imagen embebida

Las imágenes pueden venir de una URL o ir **embebidas en el propio markdown** (data URI) — se cargan de forma diferida:

![Badge de Cortex](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='360'%20height='80'%3E%3Cdefs%3E%3ClinearGradient%20id='g'%20x1='0'%20y1='0'%20x2='1'%20y2='1'%3E%3Cstop%20offset='0'%20stop-color='%236366f1'/%3E%3Cstop%20offset='1'%20stop-color='%2338bdf8'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width='360'%20height='80'%20rx='14'%20fill='url(%23g)'/%3E%3Ctext%20x='180'%20y='48'%20text-anchor='middle'%20font-family='Arial'%20font-size='26'%20font-weight='bold'%20fill='white'%3ECortex%3C/text%3E%3C/svg%3E)

## 💻 Código con resaltado

\`\`\`typescript
interface Nota {
  id: string;
  titulo: string;
  tags: string[];
}

function crearNota(titulo: string): Nota {
  return { id: crypto.randomUUID(), titulo, tags: ['demo'] };
}
\`\`\`

## 🧜 Diagrama Mermaid

Los bloques \`mermaid\` se renderizan como diagrama:

\`\`\`mermaid
flowchart LR
  A[📄 Nota A] -->|wikilink| B[📄 Nota B]
  A --> C{🧠 IA}
  C -->|similitud| D[Relacionados]
  C -->|términos| E[Knowledge Graph]
\`\`\`

## ✏️ Diagrama draw.io (editable)

Este diagrama está **embebido y es editable**: pulsa "Editar diagrama", modifícalo en draw.io y al guardar se actualiza dentro de esta nota.

\`\`\`drawio
<mxfile host="embed.diagrams.net">
  <diagram id="demo-1" name="Página 1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="500" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="Usuario" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#6366f1;fontColor=#ffffff;strokeColor=none;" vertex="1" parent="1"><mxGeometry x="80" y="120" width="140" height="60" as="geometry"/></mxCell>
        <mxCell id="3" value="Cortex" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#38bdf8;fontColor=#0a0e27;strokeColor=none;" vertex="1" parent="1"><mxGeometry x="330" y="120" width="140" height="60" as="geometry"/></mxCell>
        <mxCell id="4" value="Agente IA" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#10b981;fontColor=#ffffff;strokeColor=none;" vertex="1" parent="1"><mxGeometry x="580" y="120" width="140" height="60" as="geometry"/></mxCell>
        <mxCell id="5" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="6" value="MCP" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" edge="1" parent="1" source="3" target="4"><mxGeometry relative="1" as="geometry"/></mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
\`\`\`

## 🧩 Propiedades (frontmatter)

Esta misma nota usa metadatos YAML al inicio — se muestran en el bloque *Properties*: título, tags (clic para buscar), alias (funcionan en WikiLinks) y propiedades personalizadas que también aparecen en el grafo.

---

¿Dudas? Mira también [[Welcome]] y [[Bienvenido]]. 🪐
`;

// Default "Home" space containing the welcome notes.
db.prepare("INSERT OR IGNORE INTO nodes (id, name, type, parent_id) VALUES ('home-folder', 'Home', 'folder', NULL)").run();
db.prepare("INSERT OR IGNORE INTO nodes (id, name, type, content) VALUES ('welcome-file', 'Welcome.md', 'file', ?)").run(WELCOME_CONTENT);
db.prepare("INSERT OR IGNORE INTO nodes (id, name, type, content) VALUES ('welcome-file-es', 'Bienvenido.md', 'file', ?)").run(WELCOME_CONTENT_ES);
db.prepare("INSERT OR IGNORE INTO nodes (id, name, type, parent_id, content) VALUES ('format-demo-file', 'Ejemplos.md', 'file', 'home-folder', ?)").run(EJEMPLOS_CONTENT);
// Refresh welcome content on every boot so existing installs get the latest version,
// and keep both welcome notes nested under the Home space.
db.prepare("UPDATE nodes SET content = ?, parent_id = 'home-folder', updated_at = CURRENT_TIMESTAMP WHERE id = 'welcome-file'").run(WELCOME_CONTENT);
db.prepare("UPDATE nodes SET content = ?, parent_id = 'home-folder', updated_at = CURRENT_TIMESTAMP WHERE id = 'welcome-file-es'").run(WELCOME_CONTENT_ES);

// Migraciones seguras
try { db.exec('ALTER TABLE nodes ADD COLUMN workspace_id TEXT'); } catch {}
// Manual ordering within a folder (drag & drop). NULL = natural name order.
try { db.exec('ALTER TABLE nodes ADD COLUMN sort_order REAL'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP'); } catch {}
try { db.exec("ALTER TABLE api_keys ADD COLUMN exposed_folders TEXT DEFAULT '[]'"); } catch {}
try { db.exec('ALTER TABLE nodes ADD COLUMN share_token TEXT'); } catch {}
try { db.exec('ALTER TABLE oauth_authorization_codes ADD COLUMN code_challenge TEXT'); } catch {}
try { db.exec("ALTER TABLE oauth_applications ADD COLUMN exposed_folders TEXT DEFAULT '[]'"); } catch {}
try { db.exec("ALTER TABLE oauth_applications ADD COLUMN client_type TEXT DEFAULT 'custom'"); } catch {}
try { db.exec("ALTER TABLE oauth_applications ADD COLUMN redirect_uri TEXT"); } catch {}
try { db.exec("ALTER TABLE oauth_applications ADD COLUMN redirect_uris TEXT DEFAULT '[]'"); } catch {}
try { db.exec("ALTER TABLE oauth_tokens ADD COLUMN refresh_token TEXT"); } catch {}
try { db.exec("ALTER TABLE user_settings ADD COLUMN byok_model TEXT"); } catch {}

// Full-text search over document bodies (FTS5). Standalone table mirrored from
// `nodes` via triggers, keyed by the implicit integer rowid (nodes.id is TEXT).
// Spanish-friendly tokenizer (diacritic-insensitive).
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
      name, content, node_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes WHEN new.type = 'file' BEGIN
      INSERT INTO nodes_fts(rowid, name, content, node_id) VALUES (new.rowid, new.name, new.content, new.id);
    END;
    CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes WHEN old.type = 'file' BEGIN
      DELETE FROM nodes_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE ON nodes WHEN new.type = 'file' BEGIN
      DELETE FROM nodes_fts WHERE rowid = old.rowid;
      INSERT INTO nodes_fts(rowid, name, content, node_id) VALUES (new.rowid, new.name, new.content, new.id);
    END;
  `);
  // One-time backfill of existing docs.
  const ftsCount = (db.prepare('SELECT count(*) AS c FROM nodes_fts').get() as { c: number }).c;
  if (ftsCount === 0) {
    db.exec(`
      INSERT INTO nodes_fts(rowid, name, content, node_id)
      SELECT rowid, name, content, id FROM nodes WHERE type = 'file'
    `);
  }
} catch (err) {
  console.error('FTS5 init failed:', err);
}

// Migrate old redirect_uris to new redirect_uri format (if needed)
try {
  const oldApps = db.prepare('SELECT id, redirect_uris FROM oauth_applications WHERE redirect_uri IS NULL').all() as any[];
  if (oldApps.length > 0) {
    const updateStmt = db.prepare('UPDATE oauth_applications SET redirect_uri = ? WHERE id = ?');
    for (const app of oldApps) {
      const uris = JSON.parse(app.redirect_uris || '[]');
      const redirectUri = uris[0] || 'https://claude.ai/api/mcp/auth_callback';
      updateStmt.run(redirectUri, app.id);
    }
  }
} catch {}

// Set default redirect_uri for any apps missing it
try {
  db.prepare("UPDATE oauth_applications SET redirect_uri = 'https://claude.ai/api/mcp/auth_callback' WHERE redirect_uri IS NULL").run();
} catch {}

// Ensure redirect_uri has a default to prevent NOT NULL errors
try {
  // Try to drop the NOT NULL constraint by recreating the table if needed
  const checkTable = db.prepare("PRAGMA table_info(oauth_applications)").all() as any[];
  const hasRedirectUri = checkTable.some(col => col.name === 'redirect_uri');
  if (!hasRedirectUri) {
    // Add the column if it doesn't exist
    db.exec('ALTER TABLE oauth_applications ADD COLUMN redirect_uri TEXT DEFAULT "https://claude.ai/api/mcp/auth_callback"');
  }
} catch {}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_nodes_workspace ON nodes(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
  CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_oauth_applications_user ON oauth_applications(user_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_applications_client_id ON oauth_applications(client_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_tokens_access_token ON oauth_tokens(access_token);
  CREATE INDEX IF NOT EXISTS idx_oauth_tokens_application ON oauth_tokens(application_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_app ON oauth_authorization_codes(application_id);
  CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON org_invitations(token);
  CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations(email);
`);

// One-time migration: backfill organizations from existing users
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.es', 'yahoo.co.uk', 'yahoo.com.ar', 'yahoo.com.mx', 'yahoo.fr',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'protonmail.com', 'proton.me',
  'mail.com', 'gmx.com', 'gmx.net',
  'yandex.com', 'yandex.ru',
]);

try {
  const orgCount = (db.prepare('SELECT COUNT(*) as c FROM organizations').get() as { c: number }).c;
  if (orgCount === 0) {
    const cryptoMod = require('crypto');
    const allUsers = db.prepare("SELECT id, email, COALESCE(created_at, CURRENT_TIMESTAMP) as created_at FROM users ORDER BY created_at ASC").all() as any[];

    db.transaction(() => {
      const usersByDomain: Record<string, any[]> = {};
      for (const u of allUsers) {
        const domain = (u.email.split('@')[1] || '').toLowerCase();
        if (!domain) continue;
        if (!usersByDomain[domain]) usersByDomain[domain] = [];
        usersByDomain[domain].push(u);
      }

      for (const [domain, users] of Object.entries(usersByDomain)) {
        const isPersonal = PERSONAL_EMAIL_DOMAINS.has(domain);
        if (isPersonal) {
          // Each user gets their own personal org
          for (const u of users) {
            const orgId = cryptoMod.randomUUID();
            db.prepare(
              "INSERT INTO organizations (id, name, domain, owner_id, is_personal) VALUES (?, ?, ?, ?, 1)"
            ).run(orgId, u.email, u.email, u.id);
            db.prepare(
              "INSERT INTO organization_members (org_id, user_id, role) VALUES (?, ?, 'owner')"
            ).run(orgId, u.id);
          }
        } else {
          // Corporate domain: first user is owner, rest are members.
          const owner = users[0];
          const orgId = cryptoMod.randomUUID();
          db.prepare(
            "INSERT INTO organizations (id, name, domain, owner_id, is_personal) VALUES (?, ?, ?, ?, 0)"
          ).run(orgId, domain, domain, owner.id);
          db.prepare(
            "INSERT INTO organization_members (org_id, user_id, role) VALUES (?, ?, 'owner')"
          ).run(orgId, owner.id);
          for (let i = 1; i < users.length; i++) {
            db.prepare(
              "INSERT OR IGNORE INTO organization_members (org_id, user_id, role) VALUES (?, ?, 'member')"
            ).run(orgId, users[i].id);
          }
        }
      }
      console.log(`✅ Backfilled organizations for ${allUsers.length} users across ${Object.keys(usersByDomain).length} domains`);
    })();
  }
} catch (err) {
  console.error('Organization backfill failed:', err);
}

// Seed superadmins from environment variable. ADMIN_EMAILS is the single source
// of truth for platform-wide superadmin (role='admin'): power over every org,
// user and subscription override. Org-level admins/owners are tracked separately
// in organization_members and must NOT carry role='admin'. To enforce that, this
// block both PROMOTES the listed emails and DEMOTES any other lingering admin.
const adminEmailsStr = process.env.ADMIN_EMAILS || '';
if (adminEmailsStr) {
  const emails = adminEmailsStr.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const crypto = require('crypto');

  db.transaction(() => {
    for (const email of emails) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
      if (!existing) {
        db.prepare("INSERT INTO users (id, email, role, created_at) VALUES (?, ?, 'admin', datetime('now'))").run(crypto.randomUUID(), email);
      } else {
        db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(email);
      }
    }
    // Demote any admin not in the configured list — superadmin is config-driven only.
    const placeholders = emails.map(() => '?').join(',');
    db.prepare(
      `UPDATE users SET role = 'user' WHERE role = 'admin' AND LOWER(email) NOT IN (${placeholders})`
    ).run(...emails);
  })();
}

export default db;
