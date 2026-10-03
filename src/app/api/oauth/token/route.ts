import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import db from '@/lib/db';
import {
  validateAuthorizationCode,
  verifyClientSecret,
  createAccessToken,
  getOAuthApplication,
  validateRefreshToken,
} from '@/lib/oauth';

function verifyPKCE(codeVerifier: string, codeChallenge: string | null): boolean {
  if (!codeChallenge) return true; // PKCE is optional
  if (!codeVerifier) return false; // If challenge exists, verifier is required

  // Calculate SHA256(code_verifier) and compare with code_challenge
  const hash = createHash('sha256').update(codeVerifier).digest();
  const calculated = Buffer.from(hash).toString('base64url');

  return calculated === codeChallenge;
}

async function parseTokenRequest(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';
  let body: Record<string, string> = {};

  if (contentType.includes('application/json')) {
    body = await request.json();
  } else {
    // Default to form-encoded (OAuth 2.0 standard)
    const text = await request.text();
    const params = new URLSearchParams(text);
    body = Object.fromEntries(params.entries());
  }

  // Support HTTP Basic auth for client credentials (RFC 6749 Section 2.3.1)
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx >= 0) {
        const basicId = decodeURIComponent(decoded.slice(0, colonIdx));
        const basicSecret = decodeURIComponent(decoded.slice(colonIdx + 1));
        if (!body.client_id) body.client_id = basicId;
        if (!body.client_secret) body.client_secret = basicSecret;
      }
    } catch {}
  }

  return body;
}

export async function POST(request: Request) {
  let parsed: Record<string, string>;
  try {
    parsed = await parseTokenRequest(request);
  } catch (err: any) {
    console.error('[Token] parse error', err);
    return NextResponse.json({ error: 'invalid_request', error_description: 'Could not parse request body' }, { status: 400 });
  }

  const { grant_type, code, client_id, client_secret, code_verifier, refresh_token } = parsed;

  // Handle refresh_token grant
  if (grant_type === 'refresh_token') {
    if (!refresh_token || !client_id) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    const app = getOAuthApplication(client_id);
    if (!app) {
      return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
    }
    // Public clients (no secret) refresh with just client_id; confidential clients must present the secret.
    if (app.secretHash && (!client_secret || !verifyClientSecret(client_id, client_secret))) {
      return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
    }
    const existing = validateRefreshToken(refresh_token);
    if (!existing) {
      return NextResponse.json({ error: 'invalid_grant', error_description: 'Refresh token invalid' }, { status: 400 });
    }
    if (app.id !== existing.applicationId) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
    }
    const { accessToken, refreshToken: newRefresh, expiresIn } = createAccessToken(existing.applicationId, existing.userId);
    return NextResponse.json({
      access_token: accessToken,
      refresh_token: newRefresh,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: 'mcp',
    }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
  }

  if (grant_type !== 'authorization_code') {
    return NextResponse.json(
      { error: 'unsupported_grant_type' },
      { status: 400 }
    );
  }

  if (!code || !client_id) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing code or client_id' },
      { status: 400 }
    );
  }

  const app = getOAuthApplication(client_id);
  if (!app) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Unknown client' },
      { status: 401 }
    );
  }

  // A public client (registered with token_endpoint_auth_method: 'none', e.g.
  // Claude.ai) has no secret and authenticates with PKCE only. A confidential
  // client must present a valid client_secret. An empty secretHash = public.
  const isPublic = !app.secretHash;
  if (!isPublic) {
    if (!client_secret || !verifyClientSecret(client_id, client_secret)) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Client authentication failed' },
        { status: 401 }
      );
    }
  }

  // Validate authorization code
  const authCode = validateAuthorizationCode(code);
  if (!authCode) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Authorization code invalid or expired' },
      { status: 400 }
    );
  }

  // Verify the code belongs to this client
  if (app.id !== authCode.applicationId) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Code does not belong to this client' },
      { status: 400 }
    );
  }

  // Public clients MUST use PKCE; confidential clients use it when present.
  if (isPublic && !authCode.codeChallenge) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'PKCE required for public clients' },
      { status: 400 }
    );
  }
  if (!verifyPKCE(code_verifier || '', authCode.codeChallenge)) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'PKCE verification failed' },
      { status: 400 }
    );
  }

  // Create access token (also returns refresh_token)
  const { accessToken, refreshToken: newRefresh, expiresIn } = createAccessToken(
    authCode.applicationId,
    authCode.userId
  );

  // If this is a DCR-created app (user_id empty), claim it for the authorizing user
  // so they can manage exposed folders from settings
  try {
    const appOwner = db.prepare('SELECT user_id FROM oauth_applications WHERE id = ?').get(authCode.applicationId) as { user_id: string } | undefined;
    if (appOwner && (!appOwner.user_id || appOwner.user_id === '')) {
      db.prepare('UPDATE oauth_applications SET user_id = ? WHERE id = ?').run(authCode.userId, authCode.applicationId);
    }
  } catch (err) {
    console.error('[Token] Failed to claim DCR app:', err);
  }

  return NextResponse.json({
    access_token: accessToken,
    refresh_token: newRefresh,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: 'mcp',
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
