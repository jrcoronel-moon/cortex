import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, randomBytes, createHash } from 'crypto';
import db from '@/lib/db';

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// RFC 7591 Dynamic Client Registration
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      client_name,
      redirect_uris,
      grant_types,
      response_types,
      token_endpoint_auth_method,
    } = body;

    const name = client_name || 'Auto-registered MCP client';
    const uris: string[] = Array.isArray(redirect_uris) ? redirect_uris : [];

    if (uris.length === 0) {
      return NextResponse.json(
        { error: 'invalid_redirect_uri', error_description: 'At least one redirect_uri is required' },
        { status: 400 }
      );
    }

    const id = randomUUID();
    const clientId = `cortex_${randomBytes(16).toString('hex')}`;
    // Public clients (token_endpoint_auth_method: 'none') authenticate with PKCE
    // and have NO secret — this is how Claude.ai registers. Only issue a secret
    // for confidential clients. An empty client_secret_hash marks a public client.
    const isPublic = token_endpoint_auth_method === 'none';
    const clientSecret = isPublic ? null : randomBytes(32).toString('hex');
    const secretHash = isPublic ? '' : hashSecret(clientSecret as string);
    const primaryRedirectUri = uris[0];

    // Auto-registered apps have no owner (user_id is empty)
    db.prepare(`
      INSERT INTO oauth_applications (id, user_id, name, client_id, client_secret_hash, client_type, redirect_uri, redirect_uris, exposed_folders)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      '', // no user owner for DCR clients
      name,
      clientId,
      secretHash,
      'dcr',
      primaryRedirectUri,
      JSON.stringify(uris),
      '[]'
    );

    const response: Record<string, unknown> = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      redirect_uris: uris,
      grant_types: grant_types || ['authorization_code', 'refresh_token'],
      response_types: response_types || ['code'],
      token_endpoint_auth_method: isPublic ? 'none' : (token_endpoint_auth_method || 'client_secret_basic'),
      client_name: name,
    };
    // Only confidential clients get a secret.
    if (!isPublic) response.client_secret = clientSecret;

    return NextResponse.json(response, {
      status: 201,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err: any) {
    console.error('DCR error:', err);
    return NextResponse.json(
      { error: 'invalid_request', error_description: err.message },
      { status: 400 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
