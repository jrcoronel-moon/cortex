# Guía Completa: Model Context Protocol (MCP) en Cortex

## Tabla de Contenidos
1. [¿Qué es MCP?](#qué-es-mcp)
2. [Arquitectura](#arquitectura)
3. [Configuración](#configuración)
4. [Conexión desde Claude.ai](#conexión-desde-claudeai)
5. [Autenticación OAuth](#autenticación-oauth)
6. [Control de Acceso por Carpetas](#control-de-acceso-por-carpetas)
7. [Referencia de Tools](#referencia-de-tools)
8. [Ejemplos Prácticos](#ejemplos-prácticos)
9. [Troubleshooting](#troubleshooting)

---

## ¿Qué es MCP?

El **Model Context Protocol (MCP)** es un protocolo estándar de Anthropic que permite a clientes de IA (como Claude) conectarse a servidores que exponen **tools** (herramientas) y **recursos**.

En el caso de Cortex, MCP permite que **Claude.ai** acceda directamente a tu base de conocimiento para:
- 📖 Buscar y leer documentos
- ✍️ Crear y actualizar notas
- 🔍 Buscar información semánticamente
- 📊 Usar tus documentos como contexto en conversaciones

### Ventajas de MCP vs. API REST tradicional

| Aspecto | MCP | API REST |
|--------|-----|----------|
| **Seguridad** | OAuth 2.0 con PKCE | Token bearer genérico |
| **Acceso** | Control por carpetas | Control global |
| **Protocolo** | JSON-RPC + SSE | HTTP/JSON |
| **Integración** | Nativa en Claude.ai | Requiere plugins |
| **Sesiones** | Stateful, con sesión ID | Stateless |

---

## Arquitectura

### Flujo Completo

```
┌─────────────────┐
│   Claude.ai     │
│   (Cliente)     │
└────────┬────────┘
         │
         │ 1. Solicita conexión OAuth
         │
    ┌────▼────────────────────────┐
    │  GET /authorize             │
    │  (PKCE Authorization Code)  │
    └────┬──────────────────────┬─┘
         │ 2. Usuario autoriza  │
         │                      │
    ┌────▼──────────────────────▼─┐
    │  POST /api/oauth/token       │
    │  (Intercambia code por token)│
    └────┬──────────────────────┬─┘
         │ 3. Token válido      │
         │                      │
    ┌────▼──────────────────────▼─┐
    │  POST /api/mcp               │
    │  (MCP messages con Bearer)   │
    │  - initialize                │
    │  - tools/list                │
    │  - tools/call (list_notes)   │
    │  - tools/call (get_note)     │
    │  - tools/call (search_notes) │
    │  - tools/call (create_note)  │
    │  - tools/call (update_note)  │
    └─────────────────────────────┘
         Devuelve respuestas SSE
```

### Componentes Principales

#### 1. **Servidor MCP** (`src/app/api/mcp/route.ts`)
- Implementa `WebStandardStreamableHTTPServerTransport`
- Registra 5 tools para manipular notas
- Maneja sesiones con `sessionId` para mantener estado
- Valida tokens OAuth en cada request

#### 2. **Flujo OAuth 2.0** 
- **Authorize** (`src/app/api/oauth/authorize/route.ts`): Genera authorization code
- **Token** (`src/app/api/oauth/token/route.ts`): Intercambia code por access_token
- **Applications** (`src/app/api/oauth/applications/route.ts`): CRUD de apps OAuth

#### 3. **Control de Acceso**
- `exposedFolders`: Array de IDs de carpetas que la app puede acceder
- Validación en cada tool mediante `isNodeInFolders()`
- Herencia por ancestros: si expones una carpeta, expones todo lo dentro

#### 4. **Almacenamiento**
```sql
-- Tablas principales
oauth_applications
  ├─ id (UUID)
  ├─ user_id (FK users)
  ├─ name (string)
  ├─ client_id (generado)
  ├─ client_secret_hash
  ├─ redirect_uris (JSON)
  └─ exposed_folders (JSON array de IDs)

oauth_tokens
  ├─ id (UUID)
  ├─ application_id (FK)
  ├─ user_id (FK)
  ├─ access_token (largo)
  └─ expires_at (timestamp unix)

oauth_authorization_codes
  ├─ code (hex string)
  ├─ application_id (FK)
  ├─ user_id (FK)
  ├─ expires_at (timestamp unix, 10 min)
  └─ code_challenge (PKCE)
```

---

## Configuración

### Requisitos Previos

- ✅ Cortex ejecutándose (`npm run dev`)
- ✅ Base de datos SQLite funcionando
- ✅ HTTPS/ngrok si accedes desde Claude.ai web (no soporta localhost)

### Paso 1: Crear una Aplicación OAuth

**Desde la UI (Settings → OAuth Applications)**

1. Abre http://localhost:3000/settings
2. Desplázate a la sección "OAuth Applications"
3. Completa el formulario:
   - **Nombre**: `Claude.ai Integration`
   - **URI de redirección**: `https://claude.ai/oauth/callback`
   - **Carpetas a exponer** (opcional): Selecciona qué carpetas quieres que vea Claude

4. Haz clic en "Registrar Aplicación"
5. Se mostrarán:
   - **Client ID**: `cortex_[uuid sin guiones]`
   - **Client Secret**: `secret_[32 bytes hex]`
   - **MCP Server URL**: `https://tu-dominio/api/mcp`

**⚠️ Copia el Client Secret ahora - no podrás verlo después**

### Paso 2: Obtener URL Pública (si estás en localhost)

Si desarrollas localmente pero quieres conectar desde Claude.ai web:

```bash
# Opción 1: ngrok (recomendado)
ngrok http 3000
# Obtendrás algo como: https://abc123.ngrok-free.dev

# Opción 2: Cloudflare Tunnel
cloudflare tunnel --url http://localhost:3000
```

**Actualiza la URI de redirección en Settings**:
- Reemplaza `https://tu-dominio` con tu URL pública
- La URL debe ser HTTPS (ngrok y Cloudflare lo proporcionan automáticamente)

---

## Conexión desde Claude.ai

### Método 1: Claude.ai Web (Recomendado)

#### Paso A: Obtener credenciales OAuth

En Settings → OAuth Applications, tienes:
```
Client ID:     cortex_abc123def456
Client Secret: secret_xyz789abc...
MCP URL:       https://tu-dominio/api/mcp
Redirect URI:  https://claude.ai/oauth/callback
```

#### Paso B: Conectar en Claude.ai

1. Abre **Claude.ai** (web)
2. Ve a **Settings** → **Integrations** → **Connect MCP Server**
3. Selecciona **OAuth 2.0**
4. Completa:
   - **Server Name**: `Cortex` (o lo que quieras)
   - **Server URL**: `https://tu-dominio/api/mcp`
   - **Client ID**: `cortex_abc123def456`
   - **Client Secret**: `secret_xyz789abc...`
   
5. Haz clic en **Connect**

6. Se abrirá un navegador para autorizar:
   - Verás una pantalla de confirmación
   - Haz clic en **Autorizar** o **Allow**
   - Serás redirigido a Claude.ai

7. ✅ Verás "mcptest4 (o tu nombre)" en la lista de integraciones

#### Paso C: Usar en una conversación

En cualquier conversación con Claude:

```
Usuario: "¿Cuáles son los puntos clave en mi documento sobre arquitectura?"

Claude: Busca en tu KB usando tools de MCP
- Llama a search_notes("arquitectura")
- Lee los documentos encontrados
- Sumariza en su respuesta
```

### Método 2: Línea de Comandos (Testing)

Para probar sin Claude.ai:

```bash
# 1. Obtén un access_token válido
TOKEN=$(sqlite3 cortex.db "SELECT access_token FROM oauth_tokens LIMIT 1")

# 2. Initialize
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    }
  }'

# 3. List tools
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```

---

## Autenticación OAuth

### Flujo Completo (Authorization Code + PKCE)

```
CLIENTE                          SERVIDOR CORTEX
   │                                │
   ├──── GET /authorize ────────────>
   │     ?client_id=cortex_abc...
   │     &redirect_uri=https://...
   │     &code_challenge=xyz... (PKCE)
   │
   │<────── Redirige a /login ─────┤
   │     (Usuario autoriza)
   │
   ├──── POST /api/oauth/token ────>
   │     ?grant_type=authorization_code
   │     &code=hex123...
   │     &code_verifier=abc... (PKCE)
   │     &client_id=cortex_abc...
   │
   │<── access_token válido ────────┤
   │    (expires_in: 3600 segundos)
   │
   ├──── POST /api/mcp ────────────>
   │     Authorization: Bearer <token>
   │     Content: JSON-RPC
   │
   │<──── SSE response ─────────────┤
```

### Detalles de Seguridad

#### PKCE (Proof Key for Code Exchange)
- **¿Por qué?**: Previene ataques de authorization code interception
- **Cómo funciona**:
  1. Cliente genera `code_verifier` (random de 43-128 chars)
  2. Crea `code_challenge = BASE64URL(SHA256(code_verifier))`
  3. Envía `code_challenge` con /authorize
  4. Cortex almacena el challenge
  5. En /token, cliente envía `code_verifier`
  6. Cortex verifica: `SHA256(code_verifier) == code_challenge`

#### Token Expiration
- **TTL**: 3600 segundos (1 hora)
- **Renovación**: No implementada aún (los tokens expiran)
- **Seguridad**: Después de 1 hora, Claude necesita reconectar

#### Almacenamiento Seguro
```python
# Client Secret siempre en hash
secret_hash = SHA256(client_secret)

# Access tokens en plaintext (necesario para validación rápida)
# ⚠️ En producción: usar encriptación de DB o vault externo
```

---

## Control de Acceso por Carpetas

### ¿Cómo funciona?

Cuando creas una OAuth Application, puedes seleccionar **qué carpetas expones**:

```
Workspace
├─ Carpeta A (expuesta ✓)
│  ├─ Nota 1 (✓ accesible)
│  └─ Nota 2 (✓ accesible)
├─ Carpeta B (no expuesta ✗)
│  ├─ Nota 3 (✗ oculta)
│  └─ Nota 4 (✗ oculta)
└─ Raíz (no expuesta ✗)
   └─ Nota 5 (✗ oculta)
```

### Implementación

```typescript
// En mcpGetNote(), mcpSearchNotes(), etc.
function isNodeInFolders(nodeId: string, folderIds: string[]): boolean {
  // Si no expusiste carpetas (array vacío), ve TODO
  if (folderIds.length === 0) return true;
  
  // Sube por la jerarquía (ancestors)
  const ancestors = getNodeAncestors(nodeId);
  
  // ¿Es algún ancestor una carpeta expuesta?
  return folderIds.some(folderId => ancestors.includes(folderId));
}
```

### Ejemplos

**Escenario 1: Sin seleccionar carpetas**
```
exposedFolders = []
Resultado: Claude ve TODOS los documentos del workspace
```

**Escenario 2: Solo Carpeta "Proyectos"**
```
exposedFolders = ["uuid-carpeta-proyectos"]
Resultado: Claude solo ve notas dentro de "Proyectos" y subcarpetas
```

**Escenario 3: Múltiples carpetas**
```
exposedFolders = ["uuid-proyectos", "uuid-docs", "uuid-api"]
Resultado: Claude ve la unión de estas 3 carpetas
```

---

## Referencia de Tools

### 1. list_notes

**Descripción**: Lista todas las notas en el workspace (filtradas por carpetas expuestas)

**Parámetros**: Ninguno

**Ejemplo de request**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list_notes",
    "arguments": {}
  }
}
```

**Respuesta**:
```json
[
  {
    "id": "uuid-123",
    "title": "Arquitectura del Sistema",
    "excerpt": "La arquitectura está basada en microservicios...",
    "updatedAt": "2026-05-12T10:30:00Z"
  },
  {
    "id": "uuid-456",
    "title": "API Documentation",
    "excerpt": "Endpoints principales: GET /users, POST /data...",
    "updatedAt": "2026-05-12T09:15:00Z"
  }
]
```

### 2. get_note

**Descripción**: Obtiene el contenido completo de una nota por ID o título

**Parámetros**:
- `id_or_title` (string): UUID de la nota o su nombre

**Ejemplo**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_note",
    "arguments": {
      "id_or_title": "uuid-123"
    }
  }
}
```

**Respuesta**:
```json
{
  "id": "uuid-123",
  "name": "Arquitectura del Sistema.md",
  "content": "# Arquitectura del Sistema\n\n## Componentes\n1. Backend\n2. Frontend\n...",
  "updatedAt": "2026-05-12T10:30:00Z"
}
```

### 3. search_notes

**Descripción**: Búsqueda semántica usando embeddings de IA

**Parámetros**:
- `query` (string): Pregunta o término a buscar

**Ejemplo**:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_notes",
    "arguments": {
      "query": "¿Cómo configurar autenticación?"
    }
  }
}
```

**Respuesta** (ranking por relevancia):
```json
[
  {
    "id": "uuid-789",
    "title": "OAuth Configuration",
    "excerpt": "Para configurar OAuth, necesitas...",
    "score": 0.92
  },
  {
    "id": "uuid-456",
    "title": "API Authentication",
    "excerpt": "Autenticación mediante JWT tokens...",
    "score": 0.78
  }
]
```

### 4. create_note

**Descripción**: Crea una nueva nota en el workspace

**Parámetros**:
- `title` (string): Nombre de la nota
- `content` (string, opcional): Contenido en markdown

**Ejemplo**:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "create_note",
    "arguments": {
      "title": "New Feature Ideas",
      "content": "## Ideas for Q2\n\n1. Dark mode\n2. API v2..."
    }
  }
}
```

**Respuesta**:
```json
{
  "id": "uuid-new-123",
  "name": "New Feature Ideas.md",
  "content": "## Ideas for Q2\n\n1. Dark mode\n2. API v2..."
}
```

### 5. update_note

**Descripción**: Actualiza el contenido de una nota existente

**Parámetros**:
- `id_or_title` (string): UUID o nombre de la nota
- `content` (string): Nuevo contenido

**Ejemplo**:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "update_note",
    "arguments": {
      "id_or_title": "uuid-123",
      "content": "# Arquitectura Actualizada\n\n## Cambios v2.0\n..."
    }
  }
}
```

**Respuesta**:
```json
{
  "id": "uuid-123",
  "updated": true
}
```

---

## Ejemplos Prácticos

### Caso 1: Claude busca en tu KB durante una conversación

```
Usuario: "Ayúdame a entender la arquitectura del proyecto"

Claude actúa internamente:
1. search_notes("arquitectura del proyecto")
2. Obtiene 3 documentos relevantes
3. get_note(uuid-1), get_note(uuid-2), get_note(uuid-3)
4. Lee todo el contenido
5. Genera respuesta contextualizada

Respuesta: "Basándome en tu documentación, la arquitectura se divide en..."
```

### Caso 2: Crear documentación automáticamente

```
Usuario: "Crea un documento de onboarding basado en nuestra arquitectura"

Claude:
1. search_notes("arquitectura")
2. search_notes("procesos")
3. search_notes("roles")
4. Lee todos los docs
5. create_note("Onboarding Guide", "# Welcome to the team\n...")

Resultado: Nueva nota creada automáticamente en tu KB
```

### Caso 3: Compartir KB con colaboradores

Sin MCP:
- Descargar PDFs
- Compartir por email
- Copiar/pegar manual

Con MCP:
- Crear OAuth app con carpetas seleccionadas
- Compartir Client ID + Secret
- El colaborador conecta en su Claude.ai
- Acceso inmediato a documentos específicos
- Actualizaciones en tiempo real

---

## Troubleshooting

### ❌ "Couldn't reload tools from the server"

**Causa**: Claude.ai no puede conectar al servidor

**Soluciones**:
```bash
# 1. Verifica que el servidor está corriendo
curl http://localhost:3000/api/mcp

# 2. Verifica HTTPS en la URL (Claude.ai solo acepta HTTPS)
# Usa ngrok: https://abc123.ngrok-free.dev/api/mcp

# 3. Verifica que el token OAuth es válido (no expirado)
sqlite3 cortex.db "SELECT expires_at FROM oauth_tokens ORDER BY expires_at DESC LIMIT 1"
```

### ❌ "Connector has no tools available"

**Causa**: El servidor respondió pero sin tools

**Soluciones**:
```bash
# Verifica que el servidor MCP responde correctamente:
TOKEN=$(sqlite3 cortex.db "SELECT access_token FROM oauth_tokens WHERE expires_at > strftime('%s', 'now') LIMIT 1")

curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}
  }'

# Debe devolver SSE stream con resultado
```

### ❌ "Note not found" en get_note

**Causa**: 
1. La nota no existe
2. El ID está en un formato incorrecto
3. La nota no está en las carpetas expuestas

**Soluciones**:
```bash
# 1. Verifica que la nota existe:
sqlite3 cortex.db "SELECT id, name FROM nodes WHERE type='file' LIMIT 5"

# 2. Usa list_notes para obtener IDs correctos
# 3. Verifica que la nota está en las carpetas expuestas

sqlite3 cortex.db "
  SELECT exposed_folders FROM oauth_applications 
  WHERE client_id = 'tu_client_id' 
"

# Luego verifica que tu nota está dentro de esas carpetas
sqlite3 cortex.db "
  SELECT id, name, parent_id FROM nodes 
  WHERE name LIKE '%nombre_de_nota%'
"
```

### ❌ "Server not initialized"

**Causa**: El cliente enviante no hizo initialize primero

**Solución**: Siempre envía `initialize` antes de llamar a otros métodos

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "myapp", "version": "1.0.0"}
  }
}
```

### ❌ Token expirado

**Síntoma**: Funciona al inicio, pero después de 1 hora deja de funcionar

**Causa**: Los tokens OAuth expiran cada 3600 segundos (1 hora)

**Solución**:
- Reconecta desde Claude.ai Settings
- O implementa refresh tokens (próxima mejora)

---

## Variables de Entorno

Si necesitas configurar el servidor MCP:

```bash
# .env.local
DB_PATH=./cortex.db              # Ruta a la base de datos
PORT=3000                       # Puerto del servidor (default)

# Para entorno de producción:
NODE_ENV=production
ADMIN_EMAILS=user@example.com   # Usuarios administradores
```

---

## APIs Relacionadas

- `GET /api/workspace` - Obtener workspaces del usuario
- `GET /api/node?workspaceId=...` - Listar carpetas/notas
- `POST /api/oauth/applications` - Crear app OAuth
- `DELETE /api/oauth/applications?id=...` - Eliminar app
- `GET /settings` - Panel de configuración

---

## Roadmap / Mejoras Futuras

- [ ] Refresh tokens (renovar tokens sin reconectar)
- [ ] Rate limiting por app
- [ ] Audit logs (quién accedió qué y cuándo)
- [ ] Revocar acceso de una app sin regenerar credentials
- [ ] Webhooks cuando se crean/actualizan notas
- [ ] Soporte para múltiples workspaces por app
- [ ] Caché de resultados de search_notes

---

## Preguntas Frecuentes

**P: ¿Puedo compartir el Client Secret con otros usuarios?**
R: ✅ Sí, pero ten cuidado. El secret da acceso a las carpetas expuestas. Es recomendable crear una app por persona/equipo.

**P: ¿Qué pasa si pierdo el Client Secret?**
R: ❌ No hay recuperación. Debes eliminar la app y crear una nueva.

**P: ¿Los tokens se pueden revocar manualmente?**
R: Actualmente no. Los tokens expiran automáticamente después de 1 hora.

**P: ¿Puedo usar MCP sin Claude.ai?**
R: ✅ Sí. Cualquier cliente MCP compatible (como otros apps o scripts) puede conectar con OAuth.

**P: ¿Es seguro poner mis documentos en MCP?**
R: ✅ Sí. Todo está protegido por OAuth 2.0 + control de acceso por carpetas. Además, Cortex está desplegado en tu propia infraestructura.

---

## Recursos Útiles

- 📖 [MCP Specification](https://modelcontextprotocol.io) - Documentación oficial
- 🔐 [OAuth 2.0 PKCE](https://tools.ietf.org/html/rfc7636) - RFC oficial
- 🎓 [Claude API Docs](https://api.anthropic.com) - Para integración con Claude
- 🛠️ [Cortex Repo](https://github.com/tu-repo) - Código fuente

---

## Cambios Recientes (May 2026)

- **Versión 1.0.0**: MCP con OAuth 2.0 + Control de acceso por carpetas
  - WebStandardStreamableHTTPServerTransport (HTTP/SSE)
  - Soporte para ngrok tunneling
  - 5 tools core para gestión de notas
  - Folder-based filtering
  - Session management

---

**Última actualización**: 12 de Mayo, 2026

*Escrito por: Cortex Team | Contribuyentes: Claude AI*
