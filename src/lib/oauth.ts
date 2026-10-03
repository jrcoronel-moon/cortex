import { randomUUID, createHash, randomBytes } from 'crypto';
import db from './db';

// ── OAuth Application Management ──────────────────────────────────────────

export type ClientType = 'claude_code' | 'claude_web' | 'chatgpt' | 'custom';

export function getRedirectUriForClientType(clientType: ClientType, customUri?: string): string {
  const redirectUris: Record<ClientType, string> = {
    claude_code: 'https://claude.ai/api/mcp/auth_callback',
    claude_web: 'https://claude.ai/oauth_callback',
    chatgpt: 'https://chatgpt.com/oauth_callback',
    custom: customUri || '',
  };
  return redirectUris[clientType];
}

export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateClientId() {
  return `cortex_${randomUUID().replace(/-/g, '')}`;
}

export function generateClientSecret() {
  return `secret_${randomBytes(32).toString('hex')}`;
}

export interface OAuthApplication {
  id: string;
  name: string;
  clientId: string;
  clientType: ClientType;
  redirectUri: string;
  exposedFolders: string[];
  createdAt: string;
}

export function createOAuthApplication(
  userId: string,
  name: string,
  clientType: ClientType = 'custom',
  exposedFolders: string[] = [],
  customRedirectUri?: string
) {
  const id = randomUUID();
  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  const secretHash = hashSecret(clientSecret);
  let redirectUri = getRedirectUriForClientType(clientType, customRedirectUri);

  // Fallback to default if redirectUri is empty
  if (!redirectUri) {
    redirectUri = 'https://claude.ai/api/mcp/auth_callback';
  }

  db.prepare(`
    INSERT INTO oauth_applications (id, user_id, name, client_id, client_secret_hash, client_type, redirect_uri, redirect_uris, exposed_folders)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, clientId, secretHash, clientType, redirectUri, JSON.stringify([redirectUri]), JSON.stringify(exposedFolders));

  return {
    id,
    name,
    clientId,
    clientSecret,
    clientType,
    redirectUri,
    exposedFolders,
  };
}

export function listOAuthApplications(userId: string): OAuthApplication[] {
  const rows = db.prepare(`
    SELECT id, name, client_id as clientId, client_type as clientType, redirect_uri as redirectUri, exposed_folders as exposedFolders, created_at as createdAt
    FROM oauth_applications WHERE user_id = ?
  `).all(userId) as any[];

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    clientId: r.clientId,
    clientType: r.clientType || 'custom',
    redirectUri: r.redirectUri,
    exposedFolders: JSON.parse(r.exposedFolders || '[]'),
    createdAt: r.createdAt,
  }));
}

export function getOAuthApplication(clientId: string) {
  const row = db.prepare(`
    SELECT id, user_id, name, client_id, client_secret_hash, client_type, redirect_uri, redirect_uris, exposed_folders
    FROM oauth_applications WHERE client_id = ?
  `).get(clientId) as any;

  if (!row) return null;
  let redirectUris: string[] = [];
  try { redirectUris = JSON.parse(row.redirect_uris || '[]'); } catch {}
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    clientId: row.client_id,
    secretHash: row.client_secret_hash,
    clientType: row.client_type || 'custom',
    redirectUri: row.redirect_uri,
    redirectUris,
    exposedFolders: JSON.parse(row.exposed_folders || '[]'),
  };
}

export function deleteOAuthApplication(applicationId: string, userId: string) {
  db.prepare(`DELETE FROM oauth_applications WHERE id = ? AND user_id = ?`).run(
    applicationId,
    userId
  );
}

// ── OAuth Authorization Flow ──────────────────────────────────────────────

export function createAuthorizationCode(
  applicationId: string,
  userId: string,
  codeChallenge?: string,
  expiresInSeconds = 600 // 10 minutes
) {
  const code = randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  db.prepare(`
    INSERT INTO oauth_authorization_codes (code, application_id, user_id, expires_at, code_challenge)
    VALUES (?, ?, ?, ?, ?)
  `).run(code, applicationId, userId, expiresAt, codeChallenge || null);

  return code;
}

export function validateAuthorizationCode(code: string) {
  const row = db.prepare(`
    SELECT application_id, user_id, expires_at, code_challenge
    FROM oauth_authorization_codes WHERE code = ?
  `).get(code) as any;

  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at < now) {
    db.prepare('DELETE FROM oauth_authorization_codes WHERE code = ?').run(code);
    return null;
  }

  // Delete the code after use
  db.prepare('DELETE FROM oauth_authorization_codes WHERE code = ?').run(code);

  return {
    applicationId: row.application_id,
    userId: row.user_id,
    codeChallenge: row.code_challenge,
  };
}

// ── OAuth Token Management ────────────────────────────────────────────────

export function createAccessToken(
  applicationId: string,
  userId: string,
  expiresInSeconds = 3600 // 1 hour
) {
  const id = randomUUID();
  const accessToken = `access_${randomBytes(32).toString('hex')}`;
  const refreshToken = `refresh_${randomBytes(32).toString('hex')}`;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  db.prepare(`
    INSERT INTO oauth_tokens (id, application_id, user_id, access_token, refresh_token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, applicationId, userId, accessToken, refreshToken, expiresAt);

  return { accessToken, refreshToken, expiresIn: expiresInSeconds };
}

export function validateRefreshToken(refreshToken: string) {
  const row = db.prepare(`
    SELECT application_id, user_id FROM oauth_tokens WHERE refresh_token = ?
  `).get(refreshToken) as { application_id: string; user_id: string } | undefined;
  return row ? { applicationId: row.application_id, userId: row.user_id } : null;
}

export function validateAccessToken(accessToken: string) {
  const row = db.prepare(`
    SELECT application_id, user_id, expires_at
    FROM oauth_tokens WHERE access_token = ?
  `).get(accessToken) as any;

  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at < now) {
    db.prepare('DELETE FROM oauth_tokens WHERE access_token = ?').run(accessToken);
    return null;
  }

  return {
    applicationId: row.application_id,
    userId: row.user_id,
  };
}

// ── OAuth Validation ──────────────────────────────────────────────────────

export function verifyClientSecret(clientId: string, clientSecret: string) {
  const app = getOAuthApplication(clientId);
  if (!app) return false;

  const secretHash = hashSecret(clientSecret);
  return secretHash === app.secretHash;
}

export function isValidRedirectUri(app: any, redirectUri: string) {
  // Accept the primary redirect_uri OR any URI registered via DCR (redirect_uris array).
  if (app.redirectUri === redirectUri) return true;
  const uris: string[] = Array.isArray(app.redirectUris) ? app.redirectUris : [];
  return uris.includes(redirectUri);
}
